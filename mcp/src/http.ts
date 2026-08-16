/**
 * Streamable HTTP transport for the MCP server, for self-hosting behind a reverse proxy.
 *
 * The server is stateless — no session ids, no per-client state — so it can be restarted or
 * placed behind a load balancer without clients noticing. It carries **no authentication**:
 * bind it to loopback (the default) or put an authenticating proxy in front of it.
 */
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export const DEFAULT_HTTP_PORT = 3000;
export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const MCP_PATH = "/mcp";

export interface HttpServerOptions {
  port?: number;
  /** Defaults to loopback, because this transport has no auth of its own. */
  host?: string;
  path?: string;
}

/**
 * Decide whether to run over HTTP, and on which port.
 *
 * `--http` turns it on, optionally with a port (`--http=8080`). `TRENDFLOW_HTTP_PORT` turns it
 * on by itself, because MCP hosts and container runtimes configure servers through the
 * environment rather than argv. Returns `undefined` for the stdio default.
 */
export function resolveHttpPort(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): number | undefined {
  const raw = Number(env.TRENDFLOW_HTTP_PORT);
  const fromEnv = Number.isInteger(raw) && raw > 0 ? raw : undefined;

  const flag = argv.find((arg) => arg === "--http" || arg.startsWith("--http="));
  if (flag === undefined) return fromEnv;

  const value = flag.slice("--http=".length);
  if (!flag.includes("=") || value === "") return fromEnv ?? DEFAULT_HTTP_PORT;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --http port: ${value}`);
  }
  return parsed;
}

/**
 * Serve MCP over Streamable HTTP. Resolves once the socket is listening.
 *
 * `createMcpServer` is called **per request**: a stateless transport carries no state between
 * requests, so each one gets a fresh server and transport, and both are closed when the
 * response ends. Build the underlying Trends client once outside this call and close over it —
 * a client per request would re-seed Google's cookie every time and re-pin the proxy pool.
 *
 * Requests are handled **one at a time**, because that shared client keeps a single Google
 * session whose widget tokens a concurrent query would overwrite. Google also rate-limits by
 * exit IP, so parallelism here buys 429s rather than throughput. A server fronting many users
 * wants a pool of clients instead.
 */
export async function startHttpServer(
  createMcpServer: () => McpServer,
  options: HttpServerOptions = {},
): Promise<Server> {
  const { port = DEFAULT_HTTP_PORT, host = DEFAULT_HTTP_HOST, path = MCP_PATH } = options;

  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };

  const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== path) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `Not found — the MCP endpoint is ${path}` }));
      return;
    }

    serialize(() => handle(req, res)).catch((error: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  return httpServer;
}
