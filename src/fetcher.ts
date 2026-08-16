import { Region, Resolution, Timeframe } from "./enums.js";
import { ResponseError, TooManyRequestsError } from "./http/errors.js";
import { ProxyPool } from "./http/proxy.js";
import { UnknownRpcError, type RpcIds } from "./http/batchexecute.js";
import type { TrendingBackend, TrendingProvider } from "./http/providers.js";
import { GoogleTrendsHttpSession } from "./http/session.js";
import type {
  InterestByRegionResult,
  InterestOverTimeResult,
  RelatedResult,
  TopicSuggestion,
  TrendingResult,
} from "./models.js";
import * as parsers from "./parsers.js";

/**
 * Recency selector for {@link GoogleTrendsFetcher.trendingNow}. This is an undocumented
 * Google parameter, so only the two values whose behaviour is verifiable are named:
 * `RISING` (8) is what trends.google.com itself sends, and `TOP` (10) returns the
 * highest-volume searches rather than the fastest-growing ones. Other values between 4 and
 * 12 also return data over varying recency windows; pass a raw number to use one.
 */
export const TrendingWindow = {
  RISING: 8,
  TOP: 10,
} as const;
export type TrendingWindow = (typeof TrendingWindow)[keyof typeof TrendingWindow];

/** Google's RPC takes the literal `"Worldwide"` rather than an empty geo. */
function trendingGeo(region: string): string {
  return region === Region.WORLDWIDE ? "Worldwide" : region;
}

export function hlFromLanguage(language: string): string {
  return language.includes("-") ? language : `${language}-US`;
}

/** Strategy for retrieving Trends data (swap in tests or alternate backends). */
export interface TrendsFetcher {
  interestOverTime(
    keywords: string[],
    timeframe: Timeframe,
    region: Region,
  ): Promise<InterestOverTimeResult>;

  interestByRegion(
    keyword: string,
    resolution: Resolution,
    region?: Region,
  ): Promise<InterestByRegionResult>;

  trendingNow(
    region?: Region | (string & {}),
    options?: { window?: number; backend?: TrendingBackend },
  ): Promise<TrendingResult>;

  relatedQueries(keyword: string): Promise<RelatedResult>;

  suggestions(query: string): Promise<TopicSuggestion[]>;
}

export interface ClientOptions {
  /** Language tag; a bare code such as `"en"` is expanded to `"en-US"`. */
  language?: string;
  /** Per-request timeout in milliseconds. Default `10000`. */
  timeout?: number;
  /** Retry count for network-level failures within a single request. Default `0`. */
  retries?: number;
  /**
   * Proxy URLs to rotate through, e.g. `["http://user:pass@gate.example.com:7000"]`.
   * One proxy is pinned per query and the pool advances only when a query fails, because
   * Google binds its cookie and widget token to the exit IP. Requires the optional
   * peer dependency `undici`. Mutually exclusive with `fetch`.
   */
  proxies?: string[];
  /**
   * How many proxies to try before giving up on a query.
   * Defaults to the pool size, capped at 5.
   */
  maxProxyAttempts?: number;
  /** Called when a query fails and the pool rotates. Useful for logging. */
  onProxyRotate?: (info: { attempt: number; error: unknown }) => void;
  /**
   * Extra request headers, merged over the browser-like defaults. Chiefly useful for varying
   * `user-agent`: Google answers the widgetdata endpoints with 429 when the agent string looks
   * like a Node HTTP client, and a server running several sessions wants them to differ.
   */
  headers?: Record<string, string>;
  /** Injectable `fetch`, for proxies, logging, or tests. Defaults to the global. */
  fetch?: typeof globalThis.fetch;
  /**
   * Override the pinned `batchexecute` RPC identifiers. They are stable for long stretches
   * but Google does rename them; this lets you patch without waiting for a release.
   */
  rpcIds?: RpcIds;
}

/**
 * Whether a failure is worth retrying on a different exit IP. A 429 or a network error
 * says "this IP is blocked"; a 404 says the endpoint is gone, so rotating cannot help.
 */
function shouldRotate(error: unknown): boolean {
  if (error instanceof TooManyRequestsError) return true;
  if (error instanceof ResponseError) return error.status === 403;
  // A renamed RPC id fails identically on every exit IP, so rotating just burns the pool.
  if (error instanceof UnknownRpcError) return false;
  return true;
}

/** Fetches data via the in-tree Google Trends HTTP session. */
export class GoogleTrendsFetcher implements TrendsFetcher {
  private readonly session: GoogleTrendsHttpSession;
  private readonly pool: ProxyPool | undefined;
  private readonly maxProxyAttempts: number;
  private readonly onProxyRotate: ClientOptions["onProxyRotate"];

  constructor(options: ClientOptions = {}) {
    const { language = "en", timeout = 10_000, retries = 0, proxies, fetch } = options;

    if (proxies && fetch) {
      throw new Error(
        "Pass either `proxies` or `fetch`, not both — a custom `fetch` decides its own routing",
      );
    }

    this.pool = proxies ? new ProxyPool(proxies) : undefined;
    this.maxProxyAttempts = options.maxProxyAttempts ?? Math.min(this.pool?.size ?? 1, 5);
    this.onProxyRotate = options.onProxyRotate;

    this.session = new GoogleTrendsHttpSession({
      hl: hlFromLanguage(language),
      tz: 360,
      timeout,
      retries,
      headers: options.headers,
      fetch: this.pool ? this.pool.asFetch() : fetch,
      rpcIds: options.rpcIds,
    });
  }

  /** The proxy currently pinned for queries, if a pool is configured. */
  get currentProxy(): string | undefined {
    return this.pool?.current();
  }

  /**
   * Run a query, moving to the next proxy and re-seeding the cookie jar if it fails in a
   * way a different exit IP could fix.
   */
  private async withRotation<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.pool) return operation();

    const attempts = Math.max(1, Math.min(this.pool.size, this.maxProxyAttempts));
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!shouldRotate(error) || attempt === attempts) throw error;
        this.pool.advance();
        // The cookie and any cached widget token belong to the previous exit IP.
        this.session.resetCookies();
        this.onProxyRotate?.({ attempt, error });
      }
    }
    throw lastError;
  }

  async interestOverTime(
    keywords: string[],
    timeframe: Timeframe,
    region: Region,
  ): Promise<InterestOverTimeResult> {
    return this.withRotation(async () => {
      await this.session.buildPayload(keywords, {
        cat: 0,
        timeframe,
        geo: region,
        gprop: "",
      });
      const def = await this.session.interestOverTime();
      return parsers.interestOverTimeToResult(def, keywords, this.session.geo);
    });
  }

  async interestByRegion(
    keyword: string,
    resolution: Resolution,
    region: Region = Region.US,
  ): Promise<InterestByRegionResult> {
    return this.withRotation(async () => {
      await this.session.buildPayload([keyword], {
        cat: 0,
        timeframe: Timeframe.PAST_YEAR,
        geo: region,
        gprop: "",
      });
      const def = await this.session.interestByRegion({ resolution, incLowVol: true });
      if (!def?.geoMapData?.length) {
        return { keyword, resolution, rows: [] };
      }
      return parsers.interestByRegionToResult(def, keyword, [keyword], resolution);
    });
  }

  /**
   * Trending searches for a region. Accepts any country code, not a fixed list, and
   * worldwide works too.
   *
   * `backend` selects the source:
   *
   * - `"rpc"` (default via `"auto"`) — 50 items with growth percentages and volume.
   * - `"rss"` — 10 items with the **news articles** behind each trend, which the RPC does
   *   not carry, but no growth figures. `window` does not apply: Google ignores it on the
   *   feed. There is no worldwide feed, so a country code is required.
   * - `"auto"` — the RPC, falling back to RSS if it fails. RPC first because it returns five
   *   times the items with real growth numbers; defaulting to RSS would quietly degrade
   *   results.
   *
   * {@link TrendingResult.source} reports which one answered.
   */
  async trendingNow(
    region: Region | (string & {}) = Region.WORLDWIDE,
    options: { window?: number; backend?: TrendingBackend } = {},
  ): Promise<TrendingResult> {
    const window = options.window ?? TrendingWindow.RISING;
    const backend = options.backend ?? "auto";
    const geo = trendingGeo(region);

    const run = async (provider: TrendingProvider): Promise<TrendingResult> => ({
      results: await provider.fetch(geo, window),
      source: provider.source,
    });

    if (backend === "rpc") return this.withRotation(() => run(this.session.rpcTrending));
    if (backend === "rss") return this.withRotation(() => run(this.session.rssTrending));

    return this.withRotation(async () => {
      try {
        return await run(this.session.rpcTrending);
      } catch {
        // The feed is a genuinely separate source: different path, no RPC id to go stale.
        return run(this.session.rssTrending);
      }
    });
  }

  /**
   * Entity suggestions for a partial query — the picker behind the UI's "Topic" results.
   *
   * Pass a returned `mid` as a keyword to any query method to measure the **topic** rather
   * than the literal phrase; a topic aggregates every spelling and translation of the same
   * concept, so it usually scores far higher than the raw string.
   *
   * Needs no cookie and no proxy: this RPC answers on IPs the widgetdata endpoints reject.
   */
  async suggestions(query: string): Promise<TopicSuggestion[]> {
    return this.withRotation(async () =>
      parsers.suggestionRowsToTopics(await this.session.suggestions(query)),
    );
  }

  /**
   * Every region Google accepts: `[code, name, slug]` per country, each with its
   * subregions. Useful for validating a geo before querying it.
   */
  async geoList(): Promise<unknown> {
    return this.withRotation(() => this.session.geoList());
  }

  async relatedQueries(keyword: string): Promise<RelatedResult> {
    return this.withRotation(async () => {
      await this.session.buildPayload([keyword], {
        cat: 0,
        timeframe: Timeframe.PAST_YEAR,
        geo: "",
        gprop: "",
      });
      const raw = await this.session.relatedQueries();
      return parsers.relatedQueriesToResult(raw, keyword);
    });
  }
}
