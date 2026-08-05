import { describe, expect, it } from "vitest";

import { GoogleTrendsHttpSession } from "../src/http/session.js";
import { TrendsJsonTransport } from "../src/http/transport.js";

function cookieResponse(): Response {
  return new Response("", { headers: { "set-cookie": "NID=xyz; Path=/" } });
}

function jsonResponse(payload: unknown, prefix = ""): Response {
  return new Response(prefix + JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}

describe("GoogleTrendsHttpSession.buildPayload", () => {
  it("rejects an unknown gprop", async () => {
    const session = new GoogleTrendsHttpSession({ fetch: async () => cookieResponse() });
    await expect(
      session.buildPayload(["a"], { gprop: "podcasts" as never }),
    ).rejects.toThrow(/gprop must be empty/);
  });

  it("keeps the previous geo when called with an empty one", async () => {
    const fetchImpl: typeof globalThis.fetch = async (input) =>
      String(input).includes("/explore/?geo=")
        ? cookieResponse()
        : jsonResponse({ widgets: [] }, ")]}'");

    const session = new GoogleTrendsHttpSession({ fetch: fetchImpl });
    await session.buildPayload(["a"], { geo: "US" });
    expect(session.geo).toBe("US");
    await session.buildPayload(["a"], { geo: "" });
    expect(session.geo).toBe("US");
  });

  it("sends one comparisonItem per keyword", async () => {
    let exploreUrl = "";
    const fetchImpl: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/explore/?geo=")) return cookieResponse();
      exploreUrl = url;
      return jsonResponse({ widgets: [] }, ")]}'");
    };

    const session = new GoogleTrendsHttpSession({ fetch: fetchImpl });
    await session.buildPayload(["a", "b"], { timeframe: "now 7-d", geo: "GB" });

    const req = JSON.parse(new URL(exploreUrl).searchParams.get("req")!);
    expect(req.comparisonItem).toEqual([
      { keyword: "a", time: "now 7-d", geo: "GB" },
      { keyword: "b", time: "now 7-d", geo: "GB" },
    ]);
  });
});

describe("GoogleTrendsHttpSession widget guards", () => {
  it("explains that buildPayload has not run yet", async () => {
    const session = new GoogleTrendsHttpSession({ fetch: async () => cookieResponse() });
    await expect(session.interestOverTime()).rejects.toThrow(/buildPayload/);
    await expect(session.interestByRegion()).rejects.toThrow(/buildPayload/);
  });
});

describe("TrendsJsonTransport", () => {
  it("trims Google's anti-JSON-hijacking prefix", async () => {
    const fetchImpl: typeof globalThis.fetch = async (input) =>
      String(input).includes("/explore/?geo=")
        ? cookieResponse()
        : jsonResponse({ ok: true }, ")]}',");

    const transport = new TrendsJsonTransport({
      hl: "en-US",
      tz: 360,
      timeout: 1000,
      headers: {},
      fetch: fetchImpl,
    });

    expect(await transport.requestJson("https://trends.google.com/x", "get", { trimChars: 5 }))
      .toEqual({ ok: true });
  });

  it("retries network failures up to the configured count", async () => {
    let attempts = 0;
    const fetchImpl: typeof globalThis.fetch = async (input) => {
      if (String(input).includes("/explore/?geo=")) return cookieResponse();
      attempts += 1;
      if (attempts < 3) throw new Error("ECONNRESET");
      return jsonResponse({ ok: true });
    };

    const transport = new TrendsJsonTransport({
      hl: "en-US",
      tz: 360,
      timeout: 1000,
      headers: {},
      retries: 2,
      fetch: fetchImpl,
    });

    expect(await transport.requestJson("https://trends.google.com/x")).toEqual({ ok: true });
    expect(attempts).toBe(3);
  });

  it("surfaces the last network error once retries run out", async () => {
    const fetchImpl: typeof globalThis.fetch = async (input) => {
      if (String(input).includes("/explore/?geo=")) return cookieResponse();
      throw new Error("ECONNRESET");
    };

    const transport = new TrendsJsonTransport({
      hl: "en-US",
      tz: 360,
      timeout: 1000,
      headers: {},
      retries: 1,
      fetch: fetchImpl,
    });

    await expect(transport.requestJson("https://trends.google.com/x")).rejects.toThrow("ECONNRESET");
  });

  it("only keeps the NID cookie", async () => {
    const fetchImpl: typeof globalThis.fetch = async () =>
      new Response("", {
        headers: { "set-cookie": "OTHER=nope; Path=/" },
      });

    const transport = new TrendsJsonTransport({
      hl: "en-US",
      tz: 360,
      timeout: 1000,
      headers: {},
      fetch: fetchImpl,
    });

    expect(await transport.fetchNidCookies()).toEqual({});
  });
});
