import { Region, Resolution, Timeframe } from "./enums.js";
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
  /** Retry count for network-level failures. Default `0`. */
  retries?: number;
  /** Injectable `fetch`, mainly for tests. Defaults to the global. */
  fetch?: typeof globalThis.fetch;
}

/** Fetches data via the in-tree {@link GoogleTrendsHttpSession}. */
export class GoogleTrendsFetcher implements TrendsFetcher {
  private readonly session: GoogleTrendsHttpSession;

  constructor(options: ClientOptions = {}) {
    const { language = "en", timeout = 10_000, retries = 0, fetch } = options;
    this.session = new GoogleTrendsHttpSession({
      hl: hlFromLanguage(language),
      tz: 360,
      timeout,
      retries,
      fetch,
    });
  }

  async interestOverTime(
    keywords: string[],
    timeframe: Timeframe,
    region: Region,
  ): Promise<InterestOverTimeResult> {
    await this.session.buildPayload(keywords, {
      cat: 0,
      timeframe,
      geo: region,
      gprop: "",
    });
    const def = await this.session.interestOverTime();
    return parsers.interestOverTimeToResult(def, keywords, this.session.geo);
  }

  async interestByRegion(
    keyword: string,
    resolution: Resolution,
    region: Region = Region.US,
  ): Promise<InterestByRegionResult> {
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
  }

  async trendingNow(region: Region): Promise<TrendingResult> {
    if (region === Region.WORLDWIDE) {
      throw new Error("Trending searches require a specific country; use e.g. Region.US");
    }
    const pn = TRENDING_PN[region];
    if (pn === undefined) {
      throw new Error(`No trendingSearches mapping for region '${region}'`);
    }
    const titles = await this.session.trendingSearches(pn);
    return parsers.trendingResultFromTitles(titles);
  }

  async relatedQueries(keyword: string): Promise<RelatedResult> {
    await this.session.buildPayload([keyword], {
      cat: 0,
      timeframe: Timeframe.PAST_YEAR,
      geo: "",
      gprop: "",
    });
    const raw = await this.session.relatedQueries();
    return parsers.relatedQueriesToResult(raw, keyword);
  }
}
