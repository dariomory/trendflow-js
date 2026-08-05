/**
 * Round-robin pool of proxy URLs.
 *
 * Rotation is deliberately **per operation, not per request**. Google binds the `NID`
 * cookie and the widget token it hands out to the IP that requested them, so sending the
 * follow-up widgetdata call from a different exit IP earns an immediate HTTP 429. A pool
 * therefore pins one proxy for the whole of a query and only advances when that query fails.
 *
 * The same reasoning applies to rotating-gateway providers: point the pool at a sticky
 * session endpoint, not a per-request rotating one.
 */

/** Minimal shape of the `undici` exports this module needs. */
interface UndiciModule {
  ProxyAgent: new (url: string) => unknown;
  fetch: (input: any, init?: any) => Promise<Response>;
}

let undiciPromise: Promise<UndiciModule> | undefined;

async function loadUndici(): Promise<UndiciModule> {
  undiciPromise ??= import("undici" as string).then(
    (mod) => mod as unknown as UndiciModule,
    () => {
      throw new Error(
        "The `proxies` option needs the optional peer dependency `undici`. " +
          "Install it with `npm install undici`, or pass your own proxied `fetch` instead.",
      );
    },
  );
  return undiciPromise;
}

export class ProxyPool {
  private readonly urls: string[];
  private index = 0;
  private readonly dispatchers = new Map<string, unknown>();

  constructor(urls: string[]) {
    const cleaned = urls.map((url) => url.trim()).filter((url) => url.length > 0);
    for (const url of cleaned) {
      try {
        new URL(url);
      } catch {
        throw new Error(`Invalid proxy URL: ${url}`);
      }
    }
    if (cleaned.length === 0) {
      throw new Error("`proxies` was given no usable proxy URLs");
    }
    this.urls = cleaned;
  }

  get size(): number {
    return this.urls.length;
  }

  /** The proxy currently pinned for requests. */
  current(): string {
    return this.urls[this.index]!;
  }

  /** Move to the next proxy, wrapping around at the end of the list. */
  advance(): void {
    this.index = (this.index + 1) % this.urls.length;
  }

  /** A `fetch` bound to the currently pinned proxy. Reused so keep-alive holds the exit IP. */
  async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = this.current();
    const { ProxyAgent, fetch: undiciFetch } = await loadUndici();

    let dispatcher = this.dispatchers.get(url);
    if (dispatcher === undefined) {
      dispatcher = new ProxyAgent(url);
      this.dispatchers.set(url, dispatcher);
    }
    return undiciFetch(input, { ...init, dispatcher });
  }

  /** Bind the pooled fetch so it can be handed to the transport as a plain function. */
  asFetch(): typeof globalThis.fetch {
    return ((input: any, init?: any) => this.fetch(input, init)) as typeof globalThis.fetch;
  }
}
