#!/usr/bin/env node
/**
 * MCP server exposing Google Trends via the `trendflow` client, over stdio.
 *
 * Configuration comes from the environment, because MCP clients launch servers with an
 * `env` block rather than command-line flags:
 *
 *   TRENDFLOW_PROXIES   comma-separated proxy URLs to rotate through
 *   TRENDFLOW_TIMEOUT   per-request timeout in milliseconds (default 30000)
 *   TRENDFLOW_LANGUAGE  language tag, e.g. "en" (default) or "de-DE"
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "trendflow";

import { registerResources, registerTools } from "./tools.js";

/** Build the client from the environment. */
export function clientFromEnv(env: NodeJS.ProcessEnv = process.env): Client {
  const proxies = (env.TRENDFLOW_PROXIES ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
  const timeout = Number(env.TRENDFLOW_TIMEOUT);

  return new Client({
    language: env.TRENDFLOW_LANGUAGE || "en",
    timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 30_000,
    ...(proxies.length > 0 ? { proxies } : {}),
  });
}

export function createServer(client: Client): McpServer {
  const server = new McpServer(
    { name: "trendflow", version: "0.1.0" },
    {
      instructions:
        "Google Trends data: what people search for, how interest changes over time, " +
        "where it is concentrated, and what is surging right now.\n\n" +
        "When the user names an entity, call search_topics first and pass the returned " +
        "topic id to the other tools — a topic covers every phrasing and translation of " +
        "a concept and measures far more search activity than the literal string.\n\n" +
        "All figures are normalized relative interest, never absolute search volume, and " +
        "are only comparable within one result set. Google rate-limits by exit IP, so an " +
        "HTTP 429 means the address is throttled, not that the query was wrong.",
    },
  );

  registerTools(server, client);
  registerResources(server, client);
  return server;
}

async function main(): Promise<void> {
  // One client for the process: Google binds its cookie and widget token to the exit IP,
  // and a fresh client per call would also reset the proxy pool's pinned proxy.
  const server = createServer(clientFromEnv());
  await server.connect(new StdioServerTransport());
}

/** True when this file is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Importing this module must not start a server — tests use the factories above.
if (isEntryPoint()) {
  main().catch((error: unknown) => {
    // stderr: stdout is the MCP transport and must carry only protocol frames.
    console.error("trendflow-mcp failed to start:", error);
    process.exit(1);
  });
}
