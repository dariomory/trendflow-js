/**
 * Trending-search backends behind a single interface, so callers need not care which
 * source answered.
 *
 * Google exposes trending searches two ways, and they are not interchangeable:
 *
 * | | RPC (`batchexecute`) | RSS feed |
 * |---|---|---|
 * | items | 50 | 10 |
 * | payload | ~2 KB JSON | ~21 KB XML |
 * | growth % / volume | yes | no — coarse buckets like `"2000+"` |
 * | news articles | no | yes |
 * | window selection | yes | ignored by Google |
 * | staleness risk | pinned RPC id | stable URL |
 *
 * `"auto"` therefore prefers the RPC and falls back to RSS: the RPC returns five times the
 * items with real growth figures, so defaulting to RSS would silently degrade results.
 * Choose `"rss"` explicitly when you want the articles.
 */
import type { TrendingItem, TrendingSource } from "../models.js";
import { trendingRowsToItems } from "../parsers.js";
import type { BatchExecuteClient } from "./batchexecute.js";
import type { TrendingRssClient } from "./rss.js";

/** How `trendingNow` picks a source. */
export type TrendingBackend = "auto" | "rpc" | "rss";

/** A source of trending searches. */
export interface TrendingProvider {
  readonly source: TrendingSource;
  fetch(geo: string, window: number): Promise<TrendingItem[]>;
}

/** The `batchexecute` RPC: more items, growth and volume, no articles. */
export class RpcTrendingProvider implements TrendingProvider {
  readonly source: TrendingSource = "rpc";

  constructor(private readonly rpc: BatchExecuteClient) {}

  async fetch(geo: string, window: number): Promise<TrendingItem[]> {
    return trendingRowsToItems(await this.rpc.trendingSearches(geo, window));
  }
}

/** The RSS feed: fewer items and no growth figures, but carries the news articles. */
export class RssTrendingProvider implements TrendingProvider {
  readonly source: TrendingSource = "rss";

  constructor(private readonly rss: TrendingRssClient) {}

  async fetch(geo: string): Promise<TrendingItem[]> {
    // The feed takes a bare country code and has no worldwide equivalent.
    const items = await this.rss.trending(geo === "Worldwide" ? "" : geo);
    return items.map((item) => ({
      title: item.title,
      growth: null,
      volume: null,
      traffic: item.approxTraffic ?? "",
      articles: item.news.map((news) => ({
        title: news.title,
        url: news.url,
        source: news.source,
        picture: news.picture,
      })),
      startedAt: item.pubDate,
    }));
  }
}
