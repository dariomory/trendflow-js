import { describe, expect, it } from "vitest";

import { Region, Timeframe } from "../src/enums.js";
import { GoogleTrendsFetcher } from "../src/fetcher.js";

/**
 * A `Client` holds one Google session, and that session is single-threaded state:
 * `buildPayload()` writes the widget tokens that `interestOverTime()` then reads. Running two
 * queries concurrently on one client interleaves those writes, and the second query silently
 * answers with the first one's widget.
 *
 * These tests pin that boundary. They are the reason a multi-tenant server must lease one
 * client per in-flight query rather than sharing a single instance across requests.
 */

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * A `fetch` stub that holds every `/api/explore` response until `expected` of them have
 * arrived, forcing both queries to be mid-flight at the same time. Each explore answers with a
 * token derived from its keyword, so the token a widgetdata request carries identifies which
 * query's payload it actually used.
 */
function stubConcurrentFetch(expected: number) {
  const barrier = deferred();
  const tokensUsed: string[] = [];
  let arrived = 0;

  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);

    if (url.includes("/explore/?geo=")) {
      return new Response("", { headers: { "set-cookie": "NID=abc123; Path=/; HttpOnly" } });
    }

    if (url.includes("/api/explore")) {
      const req = JSON.parse(new URL(url).searchParams.get("req")!);
      const keyword = req.comparisonItem[0].keyword;

      arrived += 1;
      if (arrived >= expected) barrier.resolve();
      await barrier.promise;

      return new Response(
        `)]}'${JSON.stringify({
          widgets: [{ id: "TIMESERIES", token: `tok-${keyword}`, request: { keyword } }],
        })}`,
        { headers: { "content-type": "application/json" } },
      );
    }

    if (url.includes("/widgetdata/multiline")) {
      tokensUsed.push(new URL(url).searchParams.get("token")!);
      return new Response(`)]}',${JSON.stringify({ default: { timelineData: [] } })}`, {
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unstubbed URL: ${url}`);
  };

  return { fetch: impl as typeof globalThis.fetch, tokensUsed };
}

describe("concurrent queries on one client", () => {
  it("collapse onto a single widget token", async () => {
    const { fetch, tokensUsed } = stubConcurrentFetch(2);
    const client = new GoogleTrendsFetcher({ fetch });

    await Promise.all([
      client.interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US),
      client.interestOverTime(["Rust"], Timeframe.PAST_YEAR, Region.US),
    ]);

    // Both queries ran, but the later buildPayload() overwrote the earlier one's widget, so
    // both timeseries requests carried the same token. One of the two answers is wrong.
    expect(tokensUsed).toHaveLength(2);
    expect(new Set(tokensUsed).size).toBe(1);
  });

  it("stay isolated when each gets its own client", async () => {
    const { fetch, tokensUsed } = stubConcurrentFetch(2);

    await Promise.all([
      new GoogleTrendsFetcher({ fetch }).interestOverTime(
        ["Python"],
        Timeframe.PAST_YEAR,
        Region.US,
      ),
      new GoogleTrendsFetcher({ fetch }).interestOverTime(["Rust"], Timeframe.PAST_YEAR, Region.US),
    ]);

    expect([...tokensUsed].sort()).toEqual(["tok-Python", "tok-Rust"]);
  });
});
