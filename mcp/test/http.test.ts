import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Client } from "trendflow";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_HTTP_PORT, resolveHttpPort, startHttpServer } from "../src/http.js";
import { createServer } from "../src/index.js";

describe("resolveHttpPort", () => {
  it("stays on stdio when nothing asks for HTTP", () => {
    expect(resolveHttpPort([], {})).toBeUndefined();
  });

  it("defaults the port for a bare --http", () => {
    expect(resolveHttpPort(["--http"], {})).toBe(DEFAULT_HTTP_PORT);
  });

  it("reads a port from --http=PORT", () => {
    expect(resolveHttpPort(["--http=8080"], {})).toBe(8080);
  });

  it("enables HTTP from the environment alone", () => {
    expect(resolveHttpPort([], { TRENDFLOW_HTTP_PORT: "9000" })).toBe(9000);
  });

  it("lets --http=PORT win over the environment", () => {
    expect(resolveHttpPort(["--http=8080"], { TRENDFLOW_HTTP_PORT: "9000" })).toBe(8080);
  });

  it("falls back to the environment for a bare --http", () => {
    expect(resolveHttpPort(["--http"], { TRENDFLOW_HTTP_PORT: "9000" })).toBe(9000);
  });

  it("ignores a nonsense environment port", () => {
    expect(resolveHttpPort([], { TRENDFLOW_HTTP_PORT: "not-a-port" })).toBeUndefined();
  });

  it("rejects a nonsense flag port", () => {
    expect(() => resolveHttpPort(["--http=nope"], {})).toThrow(/Invalid --http port/);
  });
});

/** Streamable HTTP answers either JSON or a single SSE frame; accept both. */
async function rpc(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!text) return undefined;

  const data = text.includes("data:")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("")
    : text;
  return JSON.parse(data);
}

describe("startHttpServer", () => {
  let running: Server | undefined;

  afterEach(async () => {
    if (running) await new Promise<void>((resolve) => running!.close(() => resolve()));
    running = undefined;
  });

  async function boot() {
    const client = {
      suggestions: vi
        .fn()
        .mockResolvedValue([{ mid: "/m/05z1_", title: "Python", type: "Programming language" }]),
    } as unknown as Client;

    running = await startHttpServer(() => createServer(client), { port: 0, host: "127.0.0.1" });
    const { port } = running.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const handshake = async () => {
      const init = await rpc(`${base}/mcp`, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      });
      await rpc(`${base}/mcp`, { jsonrpc: "2.0", method: "notifications/initialized" });
      return init;
    };

    return { base, client, handshake };
  }

  it("serves the MCP handshake and lists tools at /mcp", async () => {
    const { base, handshake } = await boot();

    const init = await handshake();
    expect(init.result.serverInfo.name).toBe("trendflow");

    const listed = await rpc(`${base}/mcp`, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = listed.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("get_trending_now");
    expect(names).toContain("search_topics");
  });

  it("runs a tool against the injected client", async () => {
    const { base, client, handshake } = await boot();
    await handshake();

    const called = await rpc(`${base}/mcp`, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "search_topics", arguments: { query: "python" } },
    });

    expect(client.suggestions).toHaveBeenCalledWith("python");
    expect(called.result.content[0].text).toContain("Programming language");
  });

  it("404s anything that is not the MCP path", async () => {
    const { base } = await boot();

    const response = await fetch(`${base}/nope`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("/mcp") });
  });
});
