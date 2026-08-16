# trendflow-mcp

An [MCP](https://modelcontextprotocol.io) server for Google Trends, built on
[`trendflow`](https://www.npmjs.com/package/trendflow). Lets an agent ask what people are
searching for, how interest changes over time, where it is concentrated, and what is surging
right now.

Self-contained: the client is bundled in, so the only runtime dependencies are the MCP SDK
and zod. Install [`undici`](https://github.com/nodejs/undici) alongside it if you want proxy
support.

📖 **Documentation: [trendflow.mory.dev/docs/mcp](https://trendflow.mory.dev/docs/mcp)** — or skip
the install entirely and point your client at the hosted server.

## Install

Point your MCP client at it — no install step needed:

```json
{
  "mcpServers": {
    "trendflow": {
      "command": "npx",
      "args": ["-y", "trendflow-mcp"]
    }
  }
}
```

Claude Code:

```bash
claude mcp add trendflow -- npx -y trendflow-mcp
```

Requires Node.js 18+.

## Tools

| Tool | What it answers |
|------|-----------------|
| `search_topics` | "What is the Trends topic id for X?" — **call this first** |
| `get_interest_over_time` | "How popular is X?" / "How do X and Y compare?" |
| `get_interest_by_region` | "Where is X popular?" |
| `get_related_queries` | "What else do people search alongside X?" |
| `get_trending_now` | "What's trending right now?" (and, via RSS, *why*) |
| `research_trend` | All of the above for one term, in a single call |

### Why `search_topics` matters

Google distinguishes a **search term** (the literal string) from a **topic** (the entity, in
every spelling and language). Passing a topic id gives a materially different answer:

```
get_interest_over_time(["/m/0mkz", "artificial intelligence"])
→ { "/m/0mkz": 62, "artificial intelligence": 1 }
```

The topic scores 62 where the literal phrase scores 1, because it aggregates every phrasing
and translation people actually search. `search_topics` is also the cheapest call here — no
cookie, no proxy, and it answers on IPs that rate-limit everything else.

## Resources

- `trendflow://regions` — every geography Google accepts, with subregions.
- `trendflow://capabilities` — what the server can answer, and the caveats that affect how
  results should be read.

## Configuration

MCP clients launch servers with an `env` block, so configuration is environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `TRENDFLOW_PROXIES` | — | Comma-separated proxy URLs to rotate through |
| `TRENDFLOW_TIMEOUT` | `30000` | Per-request timeout in milliseconds |
| `TRENDFLOW_LANGUAGE` | `en` | Language tag, e.g. `de-DE` |
| `TRENDFLOW_HTTP_PORT` | — | Serve Streamable HTTP on this port instead of stdio |
| `TRENDFLOW_HTTP_HOST` | `127.0.0.1` | Interface to bind in HTTP mode |

```json
{
  "mcpServers": {
    "trendflow": {
      "command": "npx",
      "args": ["-y", "trendflow-mcp"],
      "env": { "TRENDFLOW_PROXIES": "http://user:pass@gate.decodo.com:7000" }
    }
  }
}
```

## HTTP mode

For self-hosting, `--http` serves the same tools over Streamable HTTP at `/mcp` instead of
stdio:

```bash
npx trendflow-mcp --http=8080
```

`--http` alone uses port 3000, and setting `TRENDFLOW_HTTP_PORT` enables HTTP mode on its own.
Point any Streamable HTTP client at it:

```json
{
  "mcpServers": {
    "trendflow": { "url": "http://127.0.0.1:8080/mcp" }
  }
}
```

Two things to know before exposing it:

- **There is no authentication.** It binds to loopback by default for that reason. Set
  `TRENDFLOW_HTTP_HOST=0.0.0.0` only behind a proxy that authenticates for you.
- **Requests are served one at a time.** The process holds a single Google session whose
  widget tokens a concurrent query would overwrite, and Google rate-limits by exit IP, so
  parallelism would buy `429`s rather than throughput. This is a single-tenant server; serving
  many users needs a pool of clients, one per in-flight query.

## Rate limits

Google rate-limits by exit IP, so `HTTP 429` is common and does not mean the query was
wrong. `search_topics` and `get_trending_now` answer on IPs that reject the others. For the
rest, set `TRENDFLOW_PROXIES` — see the
[proxy docs](https://github.com/dariomory/trendflow-js#using-a-proxy-pool).

## Reading the numbers

Trends values are **normalized relative interest** (0–100 within one result set), never
absolute search volume, and are only comparable inside a single result. The server states
this in its instructions and in `trendflow://capabilities`, because models otherwise report
them as search counts.

## License

MIT
