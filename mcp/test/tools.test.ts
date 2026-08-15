import { Client } from "trendflow";
import { describe, expect, it, vi } from "vitest";

import { clientFromEnv, createServer } from "../src/index.js";
import { toJsonSafe } from "../src/serialize.js";

/**
 * Drives tools the way a client does: register them against a stub server that captures the
 * config and handler, then invoke the handler directly.
 */
type Captured = {
  config: { description?: string; inputSchema?: Record<string, unknown> };
  handler: (args: any) => Promise<any>;
};

function collectTools(client: Client) {
  const tools = new Map<string, Captured>();
  const resources = new Map<string, { handler: (uri: URL) => Promise<any> }>();
  const server = {
    registerTool: (name: string, config: any, handler: any) => tools.set(name, { config, handler }),
    registerResource: (name: string, _uri: any, _config: any, handler: any) =>
      resources.set(name, { handler }),
  } as any;

  // Import lazily so the stub is in place before registration runs.
  return import("../src/tools.js").then(({ registerTools, registerResources }) => {
    registerTools(server, client);
    registerResources(server, client);
    return { tools, resources };
  });
}

function stubClient(overrides: Partial<Record<string, any>> = {}): Client {
  return {
    suggestions: vi.fn().mockResolvedValue([
      { mid: "/m/0mkz", title: "Artificial intelligence", type: "Professional field" },
    ]),
    interestOverTime: vi.fn().mockResolvedValue({
      keywords: ["a"],
      granularity: "weekly",
      points: [{ date: new Date("2024-01-01T00:00:00Z"), scores: { a: 80 } }],
    }),
    interestByRegion: vi
      .fn()
      .mockResolvedValue({ keyword: "a", resolution: "COUNTRY", rows: [{ label: "US", value: 100 }] }),
    relatedQueries: vi.fn().mockResolvedValue({ top: [{ term: "x", value: 1 }], rising: [] }),
    trendingNow: vi.fn().mockResolvedValue({
      source: "rpc",
      results: Array.from({ length: 50 }, (_, i) => ({
        title: `t${i}`,
        growth: 100,
        volume: 1,
        traffic: "+100%",
        articles: [],
        startedAt: null,
      })),
    }),
    geoList: vi.fn().mockResolvedValue([["US", "United States"]]),
    ...overrides,
  } as unknown as Client;
}

const parse = (result: any) => JSON.parse(result.content[0].text);

describe("toJsonSafe", () => {
  it("converts dates to ISO strings, including nested ones", () => {
    expect(toJsonSafe({ d: new Date("2024-01-01T00:00:00Z"), list: [{ d: new Date(0) }] })).toEqual({
      d: "2024-01-01T00:00:00.000Z",
      list: [{ d: "1970-01-01T00:00:00.000Z" }],
    });
  });

  it("leaves primitives and nulls alone", () => {
    expect(toJsonSafe({ a: 1, b: "x", c: null, d: false })).toEqual({ a: 1, b: "x", c: null, d: false });
  });
});

describe("tool registration", () => {
  it("registers the six tools and two resources", async () => {
    const { tools, resources } = await collectTools(stubClient());
    expect([...tools.keys()].sort()).toEqual([
      "get_interest_by_region",
      "get_interest_over_time",
      "get_related_queries",
      "get_trending_now",
      "research_trend",
      "search_topics",
    ]);
    expect([...resources.keys()].sort()).toEqual(["capabilities", "regions"]);
  });

  it("gives every tool a description that says when to use it", async () => {
    const { tools } = await collectTools(stubClient());
    for (const [name, { config }] of tools) {
      expect(config.description, name).toBeTruthy();
      expect(config.description!.length, name).toBeGreaterThan(80);
    }
  });
});

describe("search_topics", () => {
  it("returns mid, title and type", async () => {
    const client = stubClient();
    const { tools } = await collectTools(client);
    const result = await tools.get("search_topics")!.handler({ query: "ai" });
    expect(parse(result).topics[0].mid).toBe("/m/0mkz");
    expect(client.suggestions).toHaveBeenCalledWith("ai");
  });
});

describe("get_interest_over_time", () => {
  it("serializes point dates as ISO strings", async () => {
    const { tools } = await collectTools(stubClient());
    const result = await tools.get("get_interest_over_time")!.handler({ keywords: ["a"] });
    expect(parse(result).points[0].date).toBe("2024-01-01T00:00:00.000Z");
  });

  it("passes a topic mid straight through as a keyword", async () => {
    const client = stubClient();
    const { tools } = await collectTools(client);
    await tools.get("get_interest_over_time")!.handler({ keywords: ["/m/0mkz"] });
    expect(client.interestOverTime).toHaveBeenCalledWith(["/m/0mkz"], "today 12-m", "US");
  });

  it("caps keywords at 5, matching what the explore endpoint accepts", async () => {
    const { tools } = await collectTools(stubClient());
    const schema = tools.get("get_interest_over_time")!.config.inputSchema as any;
    expect(schema.keywords.safeParse(["a", "b", "c", "d", "e", "f"]).success).toBe(false);
    expect(schema.keywords.safeParse(["a"]).success).toBe(true);
  });

  it("rejects a malformed region but accepts a code outside the enum", async () => {
    const { tools } = await collectTools(stubClient());
    const schema = tools.get("get_interest_over_time")!.config.inputSchema as any;
    expect(schema.region.safeParse("United States").success).toBe(false);
    expect(schema.region.safeParse("PT").success).toBe(true);
  });
});

describe("get_trending_now", () => {
  it("truncates to the limit and flags that it did", async () => {
    const { tools } = await collectTools(stubClient());
    const result = parse(await tools.get("get_trending_now")!.handler({ limit: 5 }));
    expect(result.results).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(result.source).toBe("rpc");
  });

  it("defaults to 20 results", async () => {
    const { tools } = await collectTools(stubClient());
    expect(parse(await tools.get("get_trending_now")!.handler({})).results).toHaveLength(20);
  });

  it("forwards the chosen backend", async () => {
    const client = stubClient();
    const { tools } = await collectTools(client);
    await tools.get("get_trending_now")!.handler({ region: "US", backend: "rss" });
    expect(client.trendingNow).toHaveBeenCalledWith("US", { backend: "rss" });
  });
});

describe("error handling", () => {
  it("returns isError with the library's message rather than throwing", async () => {
    const client = stubClient({
      relatedQueries: vi.fn().mockRejectedValue(
        Object.assign(new Error("code 429. Google rate-limits by exit IP"), {
          name: "TooManyRequestsError",
        }),
      ),
    });
    const { tools } = await collectTools(client);
    const result = await tools.get("get_related_queries")!.handler({ keyword: "a" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("TooManyRequestsError");
    expect(result.content[0].text).toContain("rate-limits by exit IP");
  });
});

describe("research_trend", () => {
  it("returns all three sections when everything succeeds", async () => {
    const { tools } = await collectTools(stubClient());
    const result = parse(await tools.get("research_trend")!.handler({ keyword: "a" }));

    expect(result.interestOverTime.data).toBeDefined();
    expect(result.byRegion.data).toBeDefined();
    expect(result.related.data).toBeDefined();
    expect(result.partial).toBeUndefined();
  });

  it("returns partial results when one leg fails", async () => {
    const client = stubClient({
      relatedQueries: vi.fn().mockRejectedValue(new Error("code 429")),
    });
    const { tools } = await collectTools(client);
    const result = parse(await tools.get("research_trend")!.handler({ keyword: "a" }));

    expect(result.partial).toBe(true);
    expect(result.failedSections).toEqual(["related"]);
    expect(result.related.error).toContain("429");
    // The sections that worked still come back.
    expect(result.interestOverTime.data.points).toHaveLength(1);
  });
});

describe("resources", () => {
  it("serves the full geo hierarchy", async () => {
    const { resources } = await collectTools(stubClient());
    const result = await resources.get("regions")!.handler(new URL("trendflow://regions"));
    expect(JSON.parse(result.contents[0].text)).toEqual([["US", "United States"]]);
  });

  it("falls back to the named region codes when geoList fails", async () => {
    const client = stubClient({ geoList: vi.fn().mockRejectedValue(new Error("429")) });
    const { resources } = await collectTools(client);
    const result = await resources.get("regions")!.handler(new URL("trendflow://regions"));
    const body = JSON.parse(result.contents[0].text);
    expect(body.error).toContain("429");
    expect(body.fallback.some((r: any) => r.code === "US")).toBe(true);
  });

  it("documents the caveats an agent needs", async () => {
    const { resources } = await collectTools(stubClient());
    const result = await resources.get("capabilities")!.handler(new URL("trendflow://capabilities"));
    const body = JSON.parse(result.contents[0].text);
    expect(body.tools).toHaveLength(6);
    expect(body.caveats.join(" ")).toContain("not absolute search volume");
  });
});

describe("clientFromEnv", () => {
  it("builds a client with no proxies by default", () => {
    expect(clientFromEnv({} as NodeJS.ProcessEnv).currentProxy).toBeUndefined();
  });

  it("splits TRENDFLOW_PROXIES into a pool", () => {
    const client = clientFromEnv({
      TRENDFLOW_PROXIES: "http://a:1, http://b:2",
    } as NodeJS.ProcessEnv);
    expect(client.currentProxy).toBe("http://a:1");
  });

  it("ignores a non-numeric timeout instead of failing", () => {
    expect(() => clientFromEnv({ TRENDFLOW_TIMEOUT: "abc" } as NodeJS.ProcessEnv)).not.toThrow();
  });
});

describe("createServer", () => {
  it("builds a server carrying agent instructions", () => {
    expect(() => createServer(stubClient())).not.toThrow();
  });
});
