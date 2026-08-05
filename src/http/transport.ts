import { BASE_TRENDS_URL, HTTP_TOO_MANY_REQUESTS } from "./endpoints.js";
import { ResponseError, TooManyRequestsError } from "./errors.js";

export type Method = "get" | "post";

export type QueryParams = Record<string, string | number | boolean>;

export interface TransportOptions {
  hl: string;
  tz: number;
  /** Per-request timeout in milliseconds. */
  timeout: number;
  headers: Record<string, string>;
  /** Retry count for network-level failures (not HTTP error statuses). */
  retries?: number;
  /** Injectable `fetch`, mainly for tests. Defaults to the global. */
  fetch?: typeof globalThis.fetch;
}

function isJsonContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return (
    ct.includes("application/json") ||
    ct.includes("application/javascript") ||
    ct.includes("text/javascript")
  );
}

function buildUrl(url: string, params?: QueryParams): string {
  if (!params) return url;
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, String(value));
  }
  return target.toString();
}

/** Read `Set-Cookie` headers across runtimes (undici exposes `getSetCookie`). */
function readSetCookies(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === "function") return withGetter.getSetCookie();
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

/** Pull just the `NID` cookie out of a response's `Set-Cookie` headers. */
function extractNid(headers: Headers): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const raw of readSetCookies(headers)) {
    const pair = raw.split(";")[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator > 0 && pair.slice(0, separator).trim() === "NID") {
      cookies.NID = pair.slice(separator + 1).trim();
    }
  }
  return cookies;
}

/** Low-level Trends host requests: NID cookie + JSON responses. */
export class TrendsJsonTransport {
  readonly timeout: number;
  readonly headers: Record<string, string>;
  cookies: Record<string, string> = {};

  private readonly hl: string;
  private readonly retries: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: TransportOptions) {
    this.hl = options.hl;
    this.timeout = options.timeout;
    this.headers = options.headers;
    this.retries = options.retries ?? 0;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("No global fetch available; pass one via the `fetch` option (Node 18+ required)");
    }
  }

  private exploreCookieUrl(): string {
    return `${BASE_TRENDS_URL}/explore/?geo=${this.hl.slice(-2)}`;
  }

  /** Fetch the `NID` consent cookie Google requires before the widget APIs answer. */
  async fetchNidCookies(): Promise<Record<string, string>> {
    const response = await this.fetchImpl(this.exploreCookieUrl(), {
      headers: this.headers,
      signal: AbortSignal.timeout(this.timeout),
    });
    return extractNid(response.headers);
  }

  /** Google rotates `NID` on most responses; keep the freshest one. */
  private refreshCookies(headers: Headers): void {
    const fresh = extractNid(headers);
    if (fresh.NID) this.cookies = fresh;
  }

  /** Populate the cookie jar once; subsequent calls reuse it. */
  async ensureCookies(): Promise<void> {
    if (Object.keys(this.cookies).length === 0) {
      this.cookies = await this.fetchNidCookies();
    }
  }

  private cookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  async requestJson(
    url: string,
    method: Method = "get",
    options: { trimChars?: number; params?: QueryParams } = {},
  ): Promise<any> {
    const { trimChars = 0, params } = options;
    await this.ensureCookies();

    const headers: Record<string, string> = { ...this.headers };
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(buildUrl(url, params), {
          method: method.toUpperCase(),
          headers,
          signal: AbortSignal.timeout(this.timeout),
        });
      } catch (error) {
        lastError = error;
        continue;
      }

      this.refreshCookies(response.headers);

      const contentType = response.headers.get("content-type") ?? "";
      if (response.status === 200 && isJsonContentType(contentType)) {
        const text = await response.text();
        return JSON.parse(text.slice(trimChars));
      }
      if (response.status === HTTP_TOO_MANY_REQUESTS) {
        throw TooManyRequestsError.fromResponse(response);
      }
      throw ResponseError.fromResponse(response);
    }
    throw lastError;
  }
}
