import { describe, expect, it, vi } from "vitest";

import { Region, Timeframe } from "../src/enums.js";
import { GoogleTrendsFetcher } from "../src/fetcher.js";
import { ProxyPool } from "../src/http/proxy.js";

describe("ProxyPool", () => {
  it("rotates round-robin and wraps around", () => {
    const pool = new ProxyPool(["http://a:1", "http://b:2"]);
    expect(pool.current()).toBe("http://a:1");
    pool.advance();
    expect(pool.current()).toBe("http://b:2");
    pool.advance();
    expect(pool.current()).toBe("http://a:1");
  });

  it("reports its size and ignores blank entries", () => {
    expect(new ProxyPool(["http://a:1", "  ", "http://b:2"]).size).toBe(2);
  });

  it("rejects an empty pool", () => {
    expect(() => new ProxyPool([])).toThrow(/no usable proxy URLs/);
    expect(() => new ProxyPool(["  "])).toThrow(/no usable proxy URLs/);
  });

  it("rejects a malformed proxy URL", () => {
    expect(() => new ProxyPool(["not a url"])).toThrow(/Invalid proxy URL/);
  });
});

describe("Client proxy options", () => {
  it("refuses both proxies and fetch", () => {
    expect(
      () => new GoogleTrendsFetcher({ proxies: ["http://a:1"], fetch: globalThis.fetch }),
    ).toThrow(/not both/);
  });

  it("exposes the pinned proxy", () => {
    const client = new GoogleTrendsFetcher({ proxies: ["http://a:1", "http://b:2"] });
    expect(client.currentProxy).toBe("http://a:1");
  });

  it("has no pinned proxy without a pool", () => {
    expect(new GoogleTrendsFetcher().currentProxy).toBeUndefined();
  });
});

/**
 * Drives rotation through the real client. The pool's own `fetch` needs undici, so these
 * stub `ProxyPool.prototype.fetch` and assert on which proxy was pinned per request.
 */
function stubPoolTransport(handler: (proxy: string, url: string) => Response) {
  return vi
    .spyOn(ProxyPool.prototype, "fetch")
    .mockImplementation(async function (this: ProxyPool, input) {
      return handler(this.current(), String(input));
    });
}

function widgetResponse(): Response {
  return new Response(
    ")]}'" +
      JSON.stringify({
        widgets: [{ id: "TIMESERIES", token: "tok", request: { time: "today 12-m" } }],
      }),
    { headers: { "content-type": "application/json" } },
  );
}

function timelineResponse(): Response {
  return new Response(
    ")]}'," +
      JSON.stringify({ default: { timelineData: [{ time: "1704067200", value: "[80]" }] } }),
    { headers: { "content-type": "application/json" } },
  );
}

describe("rotation on failure", () => {
  it("advances to the next proxy after a 429 and succeeds", async () => {
    const seen: string[] = [];
    const spy = stubPoolTransport((proxy, url) => {
      if (url.includes("/explore/?geo=")) {
        return new Response("", { headers: { "set-cookie": `NID=${proxy}; Path=/` } });
      }
      seen.push(proxy);
      if (proxy === "http://bad:1") return new Response("nope", { status: 429 });
      if (url.includes("/api/explore")) return widgetResponse();
      return timelineResponse();
    });

    const rotations: number[] = [];
    const client = new GoogleTrendsFetcher({
      proxies: ["http://bad:1", "http://good:2"],
      onProxyRotate: ({ attempt }) => rotations.push(attempt),
    });

    const result = await client.interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US);

    expect(result.points).toHaveLength(1);
    expect(seen).toEqual(["http://bad:1", "http://good:2", "http://good:2"]);
    expect(rotations).toEqual([1]);
    expect(client.currentProxy).toBe("http://good:2");
    spy.mockRestore();
  });

  it("re-seeds the cookie jar so the new IP does not reuse the old cookie", async () => {
    const cookiesSent: string[] = [];
    const spy = stubPoolTransport((proxy, url) => {
      if (url.includes("/explore/?geo=")) {
        return new Response("", { headers: { "set-cookie": `NID=${proxy}; Path=/` } });
      }
      if (proxy === "http://bad:1") return new Response("nope", { status: 429 });
      if (url.includes("/api/explore")) return widgetResponse();
      return timelineResponse();
    });

    const original = ProxyPool.prototype.fetch;
    const wrapper = vi
      .spyOn(ProxyPool.prototype, "fetch")
      .mockImplementation(async function (this: ProxyPool, input, init) {
        const cookie = new Headers(init?.headers ?? {}).get("cookie");
        if (cookie) cookiesSent.push(cookie);
        return original.call(this, input, init);
      });

    const client = new GoogleTrendsFetcher({ proxies: ["http://bad:1", "http://good:2"] });
    await client.interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US);

    // First attempt carries the bad proxy's cookie; after rotating, the good proxy's.
    expect(cookiesSent[0]).toBe("NID=http://bad:1");
    expect(cookiesSent.slice(1)).toEqual(["NID=http://good:2", "NID=http://good:2"]);
    wrapper.mockRestore();
    spy.mockRestore();
  });

  it("gives up after trying every proxy", async () => {
    const attempts: string[] = [];
    const spy = stubPoolTransport((proxy, url) => {
      if (url.includes("/explore/?geo=")) {
        return new Response("", { headers: { "set-cookie": "NID=x; Path=/" } });
      }
      attempts.push(proxy);
      return new Response("nope", { status: 429 });
    });

    const client = new GoogleTrendsFetcher({ proxies: ["http://a:1", "http://b:2"] });
    await expect(
      client.interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US),
    ).rejects.toThrow(/429/);
    expect(attempts).toEqual(["http://a:1", "http://b:2"]);
    spy.mockRestore();
  });

  it("does not rotate on a 404, which a different IP cannot fix", async () => {
    const attempts: string[] = [];
    const spy = stubPoolTransport((proxy, url) => {
      if (url.includes("/explore/?geo=")) {
        return new Response("", { headers: { "set-cookie": "NID=x; Path=/" } });
      }
      attempts.push(proxy);
      return new Response("gone", { status: 404 });
    });

    const client = new GoogleTrendsFetcher({ proxies: ["http://a:1", "http://b:2"] });
    await expect(client.trendingNow(Region.US)).rejects.toThrow(/404/);
    expect(attempts).toEqual(["http://a:1"]);
    spy.mockRestore();
  });

  it("honours maxProxyAttempts", async () => {
    const attempts: string[] = [];
    const spy = stubPoolTransport((proxy, url) => {
      if (url.includes("/explore/?geo=")) {
        return new Response("", { headers: { "set-cookie": "NID=x; Path=/" } });
      }
      attempts.push(proxy);
      return new Response("nope", { status: 429 });
    });

    const client = new GoogleTrendsFetcher({
      proxies: ["http://a:1", "http://b:2", "http://c:3", "http://d:4"],
      maxProxyAttempts: 2,
    });

    await expect(
      client.interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US),
    ).rejects.toThrow(/429/);

    // Stops at 2 of the 4 available proxies.
    expect(attempts).toEqual(["http://a:1", "http://b:2"]);
    spy.mockRestore();
  });
});
