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
