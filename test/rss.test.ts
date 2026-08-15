import { describe, expect, it } from "vitest";

import { Region } from "../src/enums.js";
import { GoogleTrendsFetcher } from "../src/fetcher.js";
import { ResponseError, TooManyRequestsError } from "../src/http/errors.js";
import { decodeXml, parseTrendingRss } from "../src/http/rss.js";

/** Shaped exactly like the live feed, including the escaped apostrophe Google emits. */
const FEED = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0">
<channel>
<title>Daily Search Trends</title>
<item>
  <title>fluminense vs palmeiras</title>
  <ht:approx_traffic>2000+</ht:approx_traffic>
  <description/>
  <pubDate>Sat, 15 Aug 2026 12:00:00 -0700</pubDate>
  <ht:picture>https://img/one</ht:picture>
  <ht:picture_source>ge</ht:picture_source>
  <ht:news_item>
    <ht:news_item_title>Lei do ex? Palmeiras aposta em Arias com &apos;coringa&apos;</ht:news_item_title>
    <ht:news_item_snippet/>
    <ht:news_item_url>https://uol.com.br/a</ht:news_item_url>
    <ht:news_item_picture>https://img/a</ht:news_item_picture>
    <ht:news_item_source>UOL</ht:news_item_source>
  </ht:news_item>
  <ht:news_item>
    <ht:news_item_title>Fluminense x Palmeiras: onde assistir</ht:news_item_title>
    <ht:news_item_url>https://ge.globo.com/b</ht:news_item_url>
    <ht:news_item_source>ge</ht:news_item_source>
  </ht:news_item>
</item>
<item>
  <title>bare entry</title>
</item>
</channel>
</rss>`;

describe("decodeXml", () => {
  it("decodes the named entities Google emits", () => {
    expect(decodeXml("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;")).toBe(`a & b <c> "d" 'e'`);
  });

  it("decodes numeric and hex references", () => {
    expect(decodeXml("&#65;&#x42;")).toBe("AB");
  });
});

describe("parseTrendingRss", () => {
  const items = parseTrendingRss(FEED);

  it("reads every item", () => {
    expect(items).toHaveLength(2);
  });

  it("reads the title, traffic bucket and start time", () => {
    expect(items[0]!.title).toBe("fluminense vs palmeiras");
    expect(items[0]!.approxTraffic).toBe("2000+");
    expect(items[0]!.pubDate?.toISOString()).toBe("2026-08-15T19:00:00.000Z");
    expect(items[0]!.picture).toBe("https://img/one");
  });

  it("reads every news item, decoding entities in titles", () => {
    expect(items[0]!.news).toHaveLength(2);
    expect(items[0]!.news[0]).toEqual({
      title: "Lei do ex? Palmeiras aposta em Arias com 'coringa'",
      url: "https://uol.com.br/a",
      source: "UOL",
      picture: "https://img/a",
    });
  });

  it("leaves optional fields null rather than throwing", () => {
    expect(items[1]!.approxTraffic).toBeNull();
    expect(items[1]!.pubDate).toBeNull();
    expect(items[1]!.picture).toBeNull();
    expect(items[1]!.news).toEqual([]);
  });

  it("returns nothing for a feed with no items", () => {
    expect(parseTrendingRss("<rss><channel></channel></rss>")).toEqual([]);
  });
});

function stubFeed(body: string, status = 200) {
  const calls: string[] = [];
  const fetchImpl = (async (input: any) => {
    calls.push(String(input));
    if (status !== 200) return new Response("nope", { status });
    return new Response(body, { headers: { "content-type": "text/xml" } });
  }) as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

describe("trendingNow with the rss backend", () => {
  it("normalizes feed entries into the shared shape", async () => {
    const { fetchImpl } = stubFeed(FEED);
    const result = await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow(Region.US, {
      backend: "rss",
    });

    expect(result.source).toBe("rss");
    expect(result.results[0]).toEqual({
      title: "fluminense vs palmeiras",
      growth: null,
      volume: null,
      traffic: "2000+",
      startedAt: new Date("2026-08-15T19:00:00.000Z"),
      articles: [
        {
          title: "Lei do ex? Palmeiras aposta em Arias com 'coringa'",
          url: "https://uol.com.br/a",
          source: "UOL",
          picture: "https://img/a",
        },
        {
          title: "Fluminense x Palmeiras: onde assistir",
          url: "https://ge.globo.com/b",
          source: "ge",
          picture: null,
        },
      ],
    });
  });

  it("requests the feed for the given country", async () => {
    const { fetchImpl, calls } = stubFeed(FEED);
    await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow(Region.NL, { backend: "rss" });
    expect(calls[0]).toContain("/trending/rss");
    expect(calls[0]).toContain("geo=NL");
  });

  it("omits geo for worldwide, which the feed has no code for", async () => {
    const { fetchImpl, calls } = stubFeed(FEED);
    await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow(Region.WORLDWIDE, {
      backend: "rss",
    });
    expect(calls[0]).not.toContain("geo=");
  });

  it("surfaces feed failures as the usual errors", async () => {
    const tooMany = stubFeed("", 429);
    await expect(
      new GoogleTrendsFetcher({ fetch: tooMany.fetchImpl }).trendingNow(Region.US, {
        backend: "rss",
      }),
    ).rejects.toBeInstanceOf(TooManyRequestsError);

    const bad = stubFeed("", 400);
    await expect(
      new GoogleTrendsFetcher({ fetch: bad.fetchImpl }).trendingNow("ZZ", { backend: "rss" }),
    ).rejects.toBeInstanceOf(ResponseError);
  });
});

describe("trendingNow backend selection", () => {
  /** RPC path fails; the feed answers. */
  function stubRpcFailsRssWorks() {
    const calls: string[] = [];
    const fetchImpl = (async (input: any) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("batchexecute")) return new Response("nope", { status: 500 });
      return new Response(FEED, { headers: { "content-type": "text/xml" } });
    }) as typeof globalThis.fetch;
    return { fetchImpl, calls };
  }

  it("auto falls back to rss when the rpc fails", async () => {
    const { fetchImpl, calls } = stubRpcFailsRssWorks();
    const result = await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow(Region.US);

    expect(result.source).toBe("rss");
    expect(result.results).toHaveLength(2);
    expect(calls[0]).toContain("batchexecute");
    expect(calls[1]).toContain("/trending/rss");
  });

  it("auto prefers the rpc and never touches the feed when it works", async () => {
    const calls: string[] = [];
    const payload = [[["", [["a", 100, 5]]]]];
    const frame = JSON.stringify([
      ["wrb.fr", "fXqlme", JSON.stringify(payload), null, null, null, "generic"],
    ]);
    const fetchImpl = (async (input: any) => {
      calls.push(String(input));
      return new Response(`)]}'\n\n${frame.length}\n${frame}\n`, {
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const result = await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow(Region.US);

    expect(result.source).toBe("rpc");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("batchexecute");
  });

  it("rss backend never calls the rpc", async () => {
    const { fetchImpl, calls } = stubFeed(FEED);
    await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow(Region.US, { backend: "rss" });
    expect(calls.every((c) => !c.includes("batchexecute"))).toBe(true);
  });
});
