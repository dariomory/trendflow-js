import { describe, expect, it } from "vitest";

import { Region } from "../src/enums.js";
import { GoogleTrendsFetcher, TrendingWindow } from "../src/fetcher.js";
import { parseBatchExecute, RPC_TRENDING, UnknownRpcError } from "../src/http/batchexecute.js";
import { ResponseError, TooManyRequestsError } from "../src/http/errors.js";

/** The real envelope shape: `)]}'` then repeating `<length>\n<json>` frames. */
function envelope(rpcId: string, payload: unknown): string {
  const inner = JSON.stringify(payload);
  const frame = JSON.stringify([["wrb.fr", rpcId, inner, null, null, null, "generic"]]);
  return `)]}'\n\n${frame.length}\n${frame}\n`;
}

const TRENDING_PAYLOAD = [
  [
    [
      "",
      [
        ["fifa world cup 2026", 3950, 7],
        ["iphone 17", 850, 6],
      ],
    ],
  ],
];

describe("parseBatchExecute", () => {
  it("unwraps the payload for the requested rpc", () => {
    expect(parseBatchExecute(envelope(RPC_TRENDING, TRENDING_PAYLOAD), RPC_TRENDING)).toEqual(
      TRENDING_PAYLOAD,
    );
  });

  it("ignores frames belonging to another rpc", () => {
    expect(parseBatchExecute(envelope("other", TRENDING_PAYLOAD), RPC_TRENDING)).toBeUndefined();
  });

  it("survives a malformed inner payload", () => {
    const frame = JSON.stringify([["wrb.fr", RPC_TRENDING, "{not json", null, null, "generic"]]);
    expect(parseBatchExecute(`)]}'\n\n${frame.length}\n${frame}\n`, RPC_TRENDING)).toBeUndefined();
  });

  it("returns undefined for an empty body", () => {
    expect(parseBatchExecute("", RPC_TRENDING)).toBeUndefined();
  });
});

function stubTrending(payload: unknown, status = 200) {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchImpl = (async (input: any, init: any) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    if (status !== 200) return new Response("nope", { status });
    return new Response(envelope(RPC_TRENDING, payload), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

describe("trendingNow", () => {
  it("parses growth and volume out of the RPC", async () => {
    const { fetchImpl } = stubTrending(TRENDING_PAYLOAD);
    const result = await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow(Region.US);

    expect(result.results).toEqual([
      { title: "fifa world cup 2026", growth: 3950, volume: 7, traffic: "+3,950%", articles: [] },
      { title: "iphone 17", growth: 850, volume: 6, traffic: "+850%", articles: [] },
    ]);
  });

  it("sends the country code and default window", async () => {
    const { fetchImpl, calls } = stubTrending(TRENDING_PAYLOAD);
    await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow(Region.NL);

    const body = decodeURIComponent(calls[0]!.body);
    expect(body).toContain('[[[\\"NL\\",\\"\\",8,null,2]]');
    expect(calls[0]!.url).toContain(`rpcids=${RPC_TRENDING}`);
  });

  it("maps worldwide to Google's literal 'Worldwide'", async () => {
    const { fetchImpl, calls } = stubTrending(TRENDING_PAYLOAD);
    await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow(Region.WORLDWIDE);
    expect(decodeURIComponent(calls[0]!.body)).toContain('\\"Worldwide\\"');
  });

  it("defaults to worldwide", async () => {
    const { fetchImpl, calls } = stubTrending(TRENDING_PAYLOAD);
    await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow();
    expect(decodeURIComponent(calls[0]!.body)).toContain('\\"Worldwide\\"');
  });

  it("accepts a country code outside the Region list", async () => {
    const { fetchImpl, calls } = stubTrending(TRENDING_PAYLOAD);
    await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow("PT");
    expect(decodeURIComponent(calls[0]!.body)).toContain('\\"PT\\"');
  });

  it("honours an explicit window", async () => {
    const { fetchImpl, calls } = stubTrending(TRENDING_PAYLOAD);
    await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow(Region.US, {
      window: TrendingWindow.TOP,
    });
    expect(decodeURIComponent(calls[0]!.body)).toContain('\\"US\\",\\"\\",10,null,2');
  });

  it("returns an empty result when the RPC yields no rows", async () => {
    const { fetchImpl } = stubTrending([]);
    const result = await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow(Region.US);
    expect(result.results).toEqual([]);
  });

  it("maps 429 and other failures onto the usual errors", async () => {
    const tooMany = stubTrending(null, 429);
    await expect(
      new GoogleTrendsFetcher({ fetch: tooMany.fetchImpl }).trendingNow(Region.US),
    ).rejects.toBeInstanceOf(TooManyRequestsError);

    const failed = stubTrending(null, 500);
    await expect(
      new GoogleTrendsFetcher({ fetch: failed.fetchImpl }).trendingNow(Region.US),
    ).rejects.toBeInstanceOf(ResponseError);
  });

  it("reports a renamed RPC id instead of returning empty", async () => {
    // Google answers with a frame for a different rpc id than the one requested.
    const fetchImpl = (async () =>
      new Response(envelope("someOtherId", TRENDING_PAYLOAD), {
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;

    const error = await new GoogleTrendsFetcher({ fetch: fetchImpl })
      .trendingNow(Region.US)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnknownRpcError);
    expect((error as UnknownRpcError).rpcId).toBe(RPC_TRENDING);
    expect((error as Error).message).toMatch(/rpcIds/);
  });

  it("uses an overridden rpc id", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: any) => {
      calls.push(String(input));
      return new Response(envelope("newId", TRENDING_PAYLOAD), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const client = new GoogleTrendsFetcher({ fetch: fetchImpl, rpcIds: { trending: "newId" } });
    const result = await client.trendingNow(Region.US);

    expect(result.results).toHaveLength(2);
    expect(calls[0]).toContain("rpcids=newId");
  });

  it("does not need a cookie, unlike the widgetdata endpoints", async () => {
    const { fetchImpl, calls } = stubTrending(TRENDING_PAYLOAD);
    await new GoogleTrendsFetcher({ fetch: fetchImpl }).trendingNow(Region.US);
    // A single request: no /explore/?geo= cookie round-trip beforehand.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("batchexecute");
  });
});
