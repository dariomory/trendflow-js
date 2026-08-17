import { describe, expect, it } from "vitest";

import { Region, Resolution, Timeframe } from "../src/enums.js";
import { GoogleTrendsFetcher, hlFromLanguage } from "../src/fetcher.js";
import { ResponseError, TooManyRequestsError } from "../src/http/errors.js";

const JAN1 = Math.floor(Date.UTC(2024, 0, 1) / 1000);
const DAY = 86_400;

interface Call {
  url: string;
  method: string;
}

/** Build a `fetch` stub that answers each Trends endpoint from a fixture map. */
function stubFetch(routes: Record<string, unknown>, calls: Call[] = []) {
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });

    if (url.includes("/explore/?geo=")) {
      return new Response("", { headers: { "set-cookie": "NID=abc123; Path=/; HttpOnly" } });
    }
    const key = Object.keys(routes).find((route) => url.includes(route));
    if (key === undefined) throw new Error(`Unstubbed URL: ${url}`);

    const payload = routes[key];
    if (payload instanceof Response) return payload;
    // Google prefixes the /api/ payloads with junk that the transport trims; hottrends is plain JSON.
    let prefix = "";
    if (url.includes("/api/explore")) prefix = ")]}'";
    else if (url.includes("/api/widgetdata/")) prefix = ")]}',";
    return new Response(prefix + JSON.stringify(payload), {
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: impl as typeof globalThis.fetch, calls };
}

const EXPLORE_WIDGETS = {
  widgets: [
    { id: "TIMESERIES", token: "tok-ts", request: { time: "today 12-m" } },
    { id: "GEO_MAP", token: "tok-geo", request: { resolution: "COUNTRY" } },
    {
      id: "RELATED_QUERIES_0",
      token: "tok-rq",
      request: {
        restriction: { complexKeywordsRestriction: { keyword: [{ value: "python" }] } },
      },
    },
  ],
};

describe("hlFromLanguage", () => {
  it("expands a bare language code", () => {
    expect(hlFromLanguage("en")).toBe("en-US");
  });

  it("leaves a full tag alone", () => {
    expect(hlFromLanguage("de-DE")).toBe("de-DE");
  });
});

describe("interestOverTime", () => {
  it("parses the timeseries widget into a result", async () => {
    const { fetch, calls } = stubFetch({
      "/api/explore": EXPLORE_WIDGETS,
      "/widgetdata/multiline": {
        default: {
          timelineData: [
            { time: String(JAN1), value: "[80,70]" },
            { time: String(JAN1 + 7 * DAY), value: "[85,65]" },
          ],
        },
      },
    });

    const client = new GoogleTrendsFetcher({ fetch });
    const result = await client.interestOverTime(
      ["Python", "JavaScript"],
      Timeframe.PAST_YEAR,
      Region.US,
    );

    expect(result.keywords).toEqual(["Python", "JavaScript"]);
    expect(result.granularity).toBe("weekly");
    expect(result.points[0]!.scores).toEqual({ Python: 80, JavaScript: 70 });

    const explore = calls.find((call) => call.url.includes("/api/explore"))!;
    expect(explore.method).toBe("POST");
    const req = JSON.parse(new URL(explore.url).searchParams.get("req")!);
    expect(req.comparisonItem).toEqual([
      { keyword: "Python", time: "today 12-m", geo: "US" },
      { keyword: "JavaScript", time: "today 12-m", geo: "US" },
    ]);
  });

  it("fetches the NID cookie once and sends it onward", async () => {
    const { fetch, calls } = stubFetch({
      "/api/explore": EXPLORE_WIDGETS,
      "/widgetdata/multiline": { default: { timelineData: [] } },
    });

    let seenCookie: string | undefined;
    const spy: typeof globalThis.fetch = async (input, init) => {
      const cookie = new Headers(init?.headers).get("cookie");
      if (cookie) seenCookie = cookie;
      return fetch(input, init);
    };

    const client = new GoogleTrendsFetcher({ fetch: spy });
    await client.interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US);

    expect(seenCookie).toBe("NID=abc123");
    expect(calls.filter((call) => call.url.includes("/explore/?geo="))).toHaveLength(1);
  });
});

describe("headers option", () => {
  it("overrides the default user-agent on every request", async () => {
    const { fetch } = stubFetch({
      "/api/explore": EXPLORE_WIDGETS,
      "/widgetdata/multiline": { default: { timelineData: [] } },
    });

    const agents: (string | null)[] = [];
    const spy: typeof globalThis.fetch = async (input, init) => {
      agents.push(new Headers(init?.headers).get("user-agent"));
      return fetch(input, init);
    };

    const client = new GoogleTrendsFetcher({ fetch: spy, headers: { "user-agent": "TrendFlow/1" } });
    await client.interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US);

    expect(agents.length).toBeGreaterThan(0);
    expect(agents.every((agent) => agent === "TrendFlow/1")).toBe(true);
  });
});

describe("interestByRegion", () => {
  it("parses geoMapData into rows", async () => {
    const { fetch } = stubFetch({
      "/api/explore": EXPLORE_WIDGETS,
      "/widgetdata/comparedgeo": {
        default: {
          geoMapData: [
            { geoName: "California", value: "[90]" },
            { geoName: "Texas", value: "[70]" },
          ],
        },
      },
    });

    const client = new GoogleTrendsFetcher({ fetch });
    const result = await client.interestByRegion("Python", Resolution.COUNTRY, Region.US);

    expect(result).toEqual({
      keyword: "Python",
      resolution: Resolution.COUNTRY,
      rows: [
        { label: "California", value: 90 },
        { label: "Texas", value: 70 },
      ],
    });
  });

  it("returns an empty result when Google sends no geoMapData", async () => {
    const { fetch } = stubFetch({
      "/api/explore": EXPLORE_WIDGETS,
      "/widgetdata/comparedgeo": { default: {} },
    });

    const client = new GoogleTrendsFetcher({ fetch });
    const result = await client.interestByRegion("Python", Resolution.COUNTRY, Region.US);
    expect(result.rows).toEqual([]);
  });
});

// trendingNow now runs on the batchexecute RPC rather than the retired hottrends endpoint;
// it is covered in batchexecute.test.ts.

describe("relatedQueries", () => {
  it("splits ranked lists into top and rising", async () => {
    const { fetch } = stubFetch({
      "/api/explore": EXPLORE_WIDGETS,
      "/widgetdata/relatedsearches": {
        default: {
          rankedList: [
            { rankedKeyword: [{ query: "python tutorial", value: 100 }] },
            { rankedKeyword: [{ query: "python 3.13", value: 5000, formattedValue: "Breakout" }] },
          ],
        },
      },
    });

    const client = new GoogleTrendsFetcher({ fetch });
    const result = await client.relatedQueries("python");

    expect(result.top).toEqual([{ term: "python tutorial", value: 100 }]);
    expect(result.rising).toEqual([{ term: "python 3.13", breakout: "Breakout" }]);
  });
});

describe("error mapping", () => {
  it("raises TooManyRequestsError on HTTP 429", async () => {
    const { fetch } = stubFetch({ "/api/explore": new Response("nope", { status: 429 }) });
    const client = new GoogleTrendsFetcher({ fetch });

    await expect(
      client.interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US),
    ).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  it("raises ResponseError on other failures", async () => {
    const { fetch } = stubFetch({ "/api/explore": new Response("nope", { status: 500 }) });
    const client = new GoogleTrendsFetcher({ fetch });

    const error = await client
      .interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ResponseError);
    expect((error as ResponseError).status).toBe(500);
  });

  it("raises ResponseError when Google answers 200 with HTML", async () => {
    const { fetch } = stubFetch({
      "/api/explore": new Response("<html>captcha</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    });
    const client = new GoogleTrendsFetcher({ fetch });

    await expect(
      client.interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US),
    ).rejects.toBeInstanceOf(ResponseError);
  });
});

describe("query filters", () => {
  /** The explore request carries the payload as a `req` query param. */
  function explorePayload(calls: Call[]): Record<string, unknown> {
    const explore = calls.find((call) => call.url.includes("/api/explore"))!;
    const req = new URL(explore.url).searchParams.get("req")!;
    return JSON.parse(req) as Record<string, unknown>;
  }

  const TIMESERIES = {
    "/api/explore": EXPLORE_WIDGETS,
    "/widgetdata/multiline": { default: { timelineData: [] } },
  };

  it("sends category and search property", async () => {
    // Both were pinned to 0 and "" by the fetcher regardless of what the caller wanted.
    const { fetch, calls } = stubFetch(TIMESERIES);
    const client = new GoogleTrendsFetcher({ fetch });

    await client.interestOverTime(["jaguar"], Timeframe.PAST_YEAR, Region.US, {
      category: 47,
      searchProperty: "youtube",
    });

    const payload = explorePayload(calls);
    expect(payload.category).toBe(47);
    expect(payload.property).toBe("youtube");
  });

  it("accepts a custom date range and a sub-region", async () => {
    const { fetch, calls } = stubFetch(TIMESERIES);
    const client = new GoogleTrendsFetcher({ fetch });

    await client.interestOverTime(["jaguar"], "2023-01-01 2023-06-30", "US-CA");

    const explore = calls.find((call) => call.url.includes("/api/explore"))!;
    expect(explore.url).toContain("US-CA");
    expect(JSON.stringify(explorePayload(calls))).toContain("2023-01-01 2023-06-30");
  });

  it("lets interestByRegion take a timeframe", async () => {
    // It hard-coded the past year, so "where was this searched last week" was unanswerable.
    const { fetch, calls } = stubFetch({
      "/api/explore": EXPLORE_WIDGETS,
      "/widgetdata/comparedgeo": { default: { geoMapData: [] } },
    });
    const client = new GoogleTrendsFetcher({ fetch });

    await client.interestByRegion("jaguar", Resolution.REGION, Region.US, {
      timeframe: Timeframe.PAST_WEEK,
    });

    expect(JSON.stringify(explorePayload(calls))).toContain("now 7-d");
  });

  it("lets relatedQueries take a region", async () => {
    // It hard-coded worldwide, silently ignoring where the caller cared about.
    const { fetch, calls } = stubFetch({
      "/api/explore": EXPLORE_WIDGETS,
      "/widgetdata/relatedsearches": { default: { rankedList: [] } },
    });
    const client = new GoogleTrendsFetcher({ fetch });

    await client.relatedQueries("jaguar", { region: Region.GB });

    const explore = calls.find((call) => call.url.includes("/api/explore"))!;
    expect(explore.url).toContain("GB");
  });

  it("rejects an unknown search property before any request", async () => {
    const { fetch, calls } = stubFetch(TIMESERIES);
    const client = new GoogleTrendsFetcher({ fetch });

    await expect(
      client.interestOverTime(["jaguar"], Timeframe.PAST_YEAR, Region.US, {
        searchProperty: "video",
      }),
    ).rejects.toThrow(/searchProperty must be one of/);
    expect(calls).toHaveLength(0);
  });

  it("defaults preserve the previous behaviour", async () => {
    const { fetch, calls } = stubFetch(TIMESERIES);
    const client = new GoogleTrendsFetcher({ fetch });

    await client.interestOverTime(["python"], Timeframe.PAST_YEAR, Region.US);

    const payload = explorePayload(calls);
    expect(payload.category).toBe(0);
    expect(payload.property).toBe("");
  });
});
