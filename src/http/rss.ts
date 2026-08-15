/**
 * Google Trends' Trending Now RSS feed.
 *
 * An independent source for trending searches, on a different host path from the
 * `batchexecute` RPC and with no RPC identifier to go stale. Its distinguishing feature is
 * that every entry carries the news articles behind the trend, which the RPC does not.
 *
 * It is *not* a lighter path, despite being a feed: it returns 10 items in ~21 KB of XML
 * where the RPC returns 50 in ~2 KB of JSON, and it reports traffic as coarse buckets
 * (`"2000+"`) rather than a growth percentage. See `providers.ts` for how the two combine.
 */
import { TRENDING_RSS } from "./endpoints.js";
import { ResponseError, TooManyRequestsError } from "./errors.js";
import { HTTP_TOO_MANY_REQUESTS } from "./endpoints.js";

/** A news article attached to a trending entry. */
export interface RssNewsItem {
  title: string;
  url: string;
  source: string;
  picture: string | null;
}

/** One `<item>` from the feed. */
export interface RssTrendingItem {
  title: string;
  /** Google's coarse traffic bucket, e.g. `"2000+"`. Null when absent. */
  approxTraffic: string | null;
  /** When Google started reporting the trend. */
  pubDate: Date | null;
  picture: string | null;
  news: RssNewsItem[];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decode the XML entities Google actually emits, including numeric references. */
export function decodeXml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name]!);
}

function tagContent(xml: string, tag: string): string | null {
  // Self-closing tags such as <description/> carry no value.
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? decodeXml(match[1]!.trim()) : null;
}

function blocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map(
    (m) => m[1]!,
  );
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Parse the feed body. Tolerates missing optional fields rather than throwing. */
export function parseTrendingRss(xml: string): RssTrendingItem[] {
  return blocks(xml, "item").map((item) => ({
    title: tagContent(item, "title") ?? "",
    approxTraffic: tagContent(item, "ht:approx_traffic"),
    pubDate: parseDate(tagContent(item, "pubDate")),
    picture: tagContent(item, "ht:picture"),
    news: blocks(item, "ht:news_item").map((news) => ({
      title: tagContent(news, "ht:news_item_title") ?? "",
      url: tagContent(news, "ht:news_item_url") ?? "",
      source: tagContent(news, "ht:news_item_source") ?? "",
      picture: tagContent(news, "ht:news_item_picture"),
    })),
  }));
}

export interface RssClientOptions {
  timeout: number;
  headers: Record<string, string>;
  fetch: typeof globalThis.fetch;
}

export class TrendingRssClient {
  private readonly timeout: number;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: RssClientOptions) {
    this.timeout = options.timeout;
    this.headers = options.headers;
    this.fetchImpl = options.fetch;
  }

  /**
   * Fetch trending searches for a geo. `geo` is a country code such as `"US"`; the feed
   * rejects an unknown one with HTTP 400.
   *
   * Google ignores `hours`, `sort` and `count` on this feed — it always returns the same 10
   * items — so no window parameter is offered.
   */
  async trending(geo: string): Promise<RssTrendingItem[]> {
    const url = new URL(TRENDING_RSS);
    if (geo) url.searchParams.set("geo", geo);

    const response = await this.fetchImpl(url.toString(), {
      headers: this.headers,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      throw TooManyRequestsError.fromResponse(response);
    }
    if (response.status !== 200) {
      throw ResponseError.fromResponse(response);
    }
    return parseTrendingRss(await response.text());
  }
}
