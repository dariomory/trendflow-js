import { Region, Resolution, Timeframe } from "./enums.js";
import { ResponseError, TooManyRequestsError } from "./http/errors.js";
import { ProxyPool } from "./http/proxy.js";
import { GoogleTrendsHttpSession } from "./http/session.js";
import type {
  InterestByRegionResult,
  InterestOverTimeResult,
  RelatedResult,
  TrendingResult,
} from "./models.js";
import * as parsers from "./parsers.js";

/** `trendingSearches(pn)` response keys — see {@link GoogleTrendsHttpSession.trendingSearches}. */
export const TRENDING_PN: Partial<Record<Region, string>> = {
  [Region.US]: "united_states",
  [Region.GB]: "united_kingdom",
  [Region.DE]: "germany",
  [Region.FR]: "france",
  [Region.IT]: "italy",
  [Region.ES]: "spain",
  [Region.CA]: "canada",
  [Region.AU]: "australia",
  [Region.JP]: "japan",
  [Region.IN]: "india",
  [Region.BR]: "brazil",
  [Region.MX]: "mexico",
  [Region.NL]: "netherlands",
  [Region.SE]: "sweden",
  [Region.PL]: "poland",
  [Region.TR]: "turkey",
};

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

  trendingNow(region: Region): Promise<TrendingResult>;

  relatedQueries(keyword: string): Promise<RelatedResult>;
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
  /** Injectable `fetch`, for proxies, logging, or tests. Defaults to the global. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Whether a failure is worth retrying on a different exit IP. A 429 or a network error
 * says "this IP is blocked"; a 404 says the endpoint is gone, so rotating cannot help.
 */
function shouldRotate(error: unknown): boolean {
  if (error instanceof TooManyRequestsError) return true;
  if (error instanceof ResponseError) return error.status === 403;
  return true;
}

/** Fetches data via the in-tree {@link GoogleTrendsHttpSession}. */
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
      fetch: this.pool ? this.pool.asFetch() : fetch,
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

  async trendingNow(region: Region): Promise<TrendingResult> {
    if (region === Region.WORLDWIDE) {
      throw new Error("Trending searches require a specific country; use e.g. Region.US");
    }
    const pn = TRENDING_PN[region];
    if (pn === undefined) {
      throw new Error(`No trendingSearches mapping for region '${region}'`);
    }
    return this.withRotation(async () => {
      const titles = await this.session.trendingSearches(pn);
      return parsers.trendingResultFromTitles(titles);
    });
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
