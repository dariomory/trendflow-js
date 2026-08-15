import type { RelatedQueriesRaw } from "../parsers.js";
import {
  BatchExecuteClient,
  type RpcIds,
  type SuggestionRow,
  type TrendingRow,
} from "./batchexecute.js";
import * as ep from "./endpoints.js";
import { RpcTrendingProvider, RssTrendingProvider, type TrendingProvider } from "./providers.js";
import { TrendingRssClient } from "./rss.js";
import { TrendsJsonTransport } from "./transport.js";

/** Google property to search within; empty string is web search. */
export type Gprop = "" | "images" | "news" | "youtube" | "froogle";

const ALLOWED_GPROPS: readonly Gprop[] = ["", "images", "news", "youtube", "froogle"];

/**
 * Google answers the widgetdata endpoints with HTTP 429 unless the request carries a
 * browser-like User-Agent — the default agent strings used by Node HTTP clients are refused
 * regardless of how few requests have been made. Override via the `headers` option.
 */
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface SessionOptions {
  hl?: string;
  tz?: number;
  geo?: string;
  /** Per-request timeout in milliseconds. */
  timeout?: number;
  retries?: number;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  /** Override the pinned batchexecute RPC identifiers if Google renames one. */
  rpcIds?: RpcIds;
}

export interface BuildPayloadOptions {
  cat?: number;
  timeframe?: string;
  geo?: string;
  gprop?: Gprop;
}

interface Widget {
  id: string;
  token: string;
  request: Record<string, any>;
}

/**
 * Stateful client for the Google Trends internal APIs (explore + widgetdata).
 *
 * Composes {@link TrendsJsonTransport} for HTTP; this class holds comparison state and
 * returns raw JSON for callers to parse (see `../parsers.ts`).
 */
export class GoogleTrendsHttpSession {
  readonly hl: string;
  readonly tz: number;
  geo: string;
  kwList: string[] = [];

  private readonly http: TrendsJsonTransport;
  private readonly rpc: BatchExecuteClient;
  readonly rpcTrending: TrendingProvider;
  readonly rssTrending: TrendingProvider;
  private interestOverTimeWidget: Widget | undefined;
  private interestByRegionWidget: Widget | undefined;
  private relatedQueriesWidgets: Widget[] = [];

  constructor(options: SessionOptions = {}) {
    this.hl = options.hl ?? "en-US";
    this.tz = options.tz ?? 360;
    this.geo = options.geo ?? "";

    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": this.hl,
      "user-agent": DEFAULT_USER_AGENT,
      origin: "https://trends.google.com",
      referer: `${ep.BASE_TRENDS_URL}/explore`,
      ...options.headers,
    };
    const timeout = options.timeout ?? 10_000;

    this.http = new TrendsJsonTransport({
      hl: this.hl,
      tz: this.tz,
      timeout,
      retries: options.retries,
      fetch: options.fetch,
      headers,
    });

    this.rpc = new BatchExecuteClient({
      hl: this.hl,
      timeout,
      headers,
      fetch: options.fetch ?? globalThis.fetch,
      rpcIds: options.rpcIds,
    });

    this.rpcTrending = new RpcTrendingProvider(this.rpc);
    this.rssTrending = new RssTrendingProvider(
      new TrendingRssClient({ timeout, headers, fetch: options.fetch ?? globalThis.fetch }),
    );
  }

  get cookies(): Record<string, string> {
    return this.http.cookies;
  }

  set cookies(value: Record<string, string>) {
    this.http.cookies = value;
  }

  /** Drop the cookie jar and cached widget tokens; both are bound to the current exit IP. */
  resetCookies(): void {
    this.http.resetCookies();
  }

  /** Set the comparison state and exchange it for widget tokens. */
  async buildPayload(kwList: string[], options: BuildPayloadOptions = {}): Promise<void> {
    const { cat = 0, timeframe = "today 5-y", geo = "", gprop = "" } = options;
    if (!ALLOWED_GPROPS.includes(gprop)) {
      throw new Error("gprop must be empty (web), images, news, youtube, or froogle");
    }
    this.kwList = kwList;
    this.geo = geo || this.geo;

    const req = {
      comparisonItem: kwList.map((keyword) => ({ keyword, time: timeframe, geo: this.geo })),
      category: cat,
      property: gprop,
    };

    const data = await this.http.requestJson(ep.EXPLORE, "post", {
      trimChars: 4,
      params: { hl: this.hl, tz: this.tz, req: JSON.stringify(req) },
    });
    this.collectWidgets(data.widgets ?? []);
  }

  private collectWidgets(widgets: Widget[]): void {
    this.relatedQueriesWidgets = [];
    this.interestOverTimeWidget = undefined;
    this.interestByRegionWidget = undefined;
    let firstRegionToken = true;
    for (const widget of widgets) {
      if (widget.id === "TIMESERIES") this.interestOverTimeWidget = widget;
      if (widget.id === "GEO_MAP" && firstRegionToken) {
        this.interestByRegionWidget = widget;
        firstRegionToken = false;
      }
      if (widget.id.includes("RELATED_QUERIES")) this.relatedQueriesWidgets.push(widget);
    }
  }

  private requireWidget(widget: Widget | undefined, name: string): Widget {
    if (!widget) {
      throw new Error(`No ${name} widget available; call buildPayload() first`);
    }
    return widget;
  }

  /** The raw `default` object from the interest-over-time widget response. */
  async interestOverTime(): Promise<Record<string, any>> {
    const widget = this.requireWidget(this.interestOverTimeWidget, "TIMESERIES");
    const data = await this.http.requestJson(ep.INTEREST_OVER_TIME, "get", {
      trimChars: 5,
      params: { req: JSON.stringify(widget.request), token: widget.token, tz: this.tz },
    });
    return data.default;
  }

  /** The raw `default` object from the interest-by-region response. */
  async interestByRegion(
    options: { resolution?: string; incLowVol?: boolean } = {},
  ): Promise<Record<string, any>> {
    const { resolution = "COUNTRY", incLowVol = false } = options;
    const widget = this.requireWidget(this.interestByRegionWidget, "GEO_MAP");

    if (this.geo === "" || (this.geo === "US" && ["DMA", "CITY", "REGION"].includes(resolution))) {
      widget.request.resolution = resolution;
    }
    widget.request.includeLowSearchVolumeGeos = incLowVol;

    const data = await this.http.requestJson(ep.INTEREST_BY_REGION, "get", {
      trimChars: 5,
      params: { req: JSON.stringify(widget.request), token: widget.token, tz: this.tz },
    });
    return data.default;
  }

  /** Per-keyword related queries: `top` / `rising` lists of ranked-keyword objects. */
  async relatedQueries(): Promise<RelatedQueriesRaw> {
    const result: RelatedQueriesRaw = {};
    for (const widget of this.relatedQueriesWidgets) {
      const keyword = String(
        widget.request?.restriction?.complexKeywordsRestriction?.keyword?.[0]?.value ?? "",
      );
      const data = await this.http.requestJson(ep.RELATED_QUERIES, "get", {
        trimChars: 5,
        params: { req: JSON.stringify(widget.request), token: widget.token, tz: this.tz },
      });
      const rankedList = data.default?.rankedList ?? [];
      result[keyword] = {
        top: rankedList[0]?.rankedKeyword ?? null,
        rising: rankedList[1]?.rankedKeyword ?? null,
      };
    }
    return result;
  }

  /**
   * Raw trending rows from the `batchexecute` RPC.
   * `geo` is `"Worldwide"` or a country code such as `"US"`.
   */
  async trendingSearches(geo: string, window: number): Promise<TrendingRow[]> {
    return this.rpc.trendingSearches(geo, window);
  }

  /** The full geo hierarchy Google's own region picker is built from. */
  async geoList(): Promise<unknown> {
    return this.rpc.geoList();
  }

  /** Entity suggestions for a partial query. */
  async suggestions(query: string): Promise<SuggestionRow[]> {
    return this.rpc.suggestions(query);
  }
}
