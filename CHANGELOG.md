# Changelog

## Unreleased

### Added

- **HTTP transport for `trendflow-mcp`.** `--http[=PORT]`, or `TRENDFLOW_HTTP_PORT`, serves the
  same tools over Streamable HTTP at `/mcp` instead of stdio, for self-hosting. Binds loopback
  by default (`TRENDFLOW_HTTP_HOST`) because it carries no authentication, and serves one
  request at a time — see the caveats in `mcp/README.md`. stdio remains the default.
- `headers` on `ClientOptions`, merged over the browser-like defaults. Chiefly for varying
  `user-agent`; `SessionOptions` already accepted it but nothing public reached it.

### Fixed

- Documented that `TrendingItem.articles` is empty only on the RPC backend. The `"rss"` backend
  has carried articles since 0.2.0, but README and docs still said the field is always empty.

Reaches feature parity with [`trendflow-py`](https://github.com/dariomory/trendflow) 0.2.0.

### Added

- **Search suggestions.** `suggestions(query)` returns `TopicSuggestion[]` from the entity
  picker the Trends UI uses. Needs no cookie and no reCAPTCHA token, and answers on IPs the
  widgetdata endpoints reject. Any query method already accepted a topic `mid` in place of a
  keyword; this makes that usable.
- **RSS trending backend.** `trendingNow(region, { backend })` takes `"auto"` (default),
  `"rpc"`, or `"rss"`, behind a `TrendingProvider` interface. The feed carries the news
  articles behind each trend, which the RPC does not.
- `geoList()` returns Google's full region hierarchy.
- `UnknownRpcError` and the `rpcIds` option, for patching a renamed `batchexecute` RPC id
  without waiting for a release.
- A rotating proxy pool: `proxies`, `maxProxyAttempts`, `onProxyRotate`, `currentProxy`.
- An MCP server, published separately as `trendflow-mcp`.

### Changed — breaking

- `TrendingItem.articles` is now `TrendingArticle[]` (title, url, source, picture) instead of
  a permanently empty `string[]`, and `TrendingItem` gains `startedAt`.
- `TrendingResult` gains `source`, reporting which backend answered.
- `trendingNow()` accepts any country code rather than a fixed list, and defaults to
  worldwide instead of throwing.

### Fixed

- A browser `User-Agent` is sent by default. Without one Google answers the widgetdata
  endpoints with HTTP 429 regardless of request volume.

## 0.1.0

Initial release — the JavaScript/TypeScript port of
[`trendflow-py`](https://github.com/dariomory/trendflow). Reaches feature parity with
[`trendflow-py`](https://github.com/dariomory/trendflow) 0.2.0.

### Core API

- `interestOverTime()`, `interestByRegion()`, `trendingNow()`, `relatedQueries()`
- `Region`, `Timeframe`, `Resolution`, `ExportFormat` as `as const` objects
- `InterestOverTimeResult.toArray()` / `toJSON()` / `toCSV()`, plus Node-only `export()`
- `ResponseError`, `TooManyRequestsError`, `UnknownRpcError`
- Injectable `fetch` for proxies, logging, and tests
- Ships ESM and CommonJS with bundled type declarations; no runtime dependencies

Not ported: the pandas `to_dataframe()` bridge (`toArray()` replaces it) and the CLI.

### Trending backends

`trendingNow()` takes a `backend` of `"auto"` (default), `"rpc"` or `"rss"`, behind a
`TrendingProvider` interface, and `TrendingResult.source` reports which answered.

- The RSS feed carries the **news articles** behind each trend — `TrendingItem.articles` is
  now `TrendingArticle[]` (title, url, source, picture) instead of a permanently empty
  `string[]`, and `startedAt` records when Google began reporting the trend.
- `"auto"` tries the RPC first and falls back to the feed. The RPC returns 50 items with
  growth percentages against the feed's 10 with coarse buckets, so preferring RSS would
  quietly degrade results.
- The feed is not a lighter path: ~21 KB of XML for 10 items versus ~2 KB of JSON for 50.
  Google also ignores `hours`, `sort` and `count` on it.

### Topics and search suggestions

- `suggestions(query)` returns `TopicSuggestion[]` — `{ mid, title, type }` — from the
  entity picker the Trends UI uses. Needs no cookie and no reCAPTCHA token, and answers on
  IPs the widgetdata endpoints reject.
- Any query method already accepts a `mid` in place of a keyword, which measures the
  **topic** (every spelling and translation of a concept) rather than the literal string.
  This worked before but was undocumented and undiscoverable; `suggestions()` is what makes
  it usable.

### Trending searches

`trendingNow()` runs on the `batchexecute` RPC that trends.google.com itself uses, rather
than the `hottrends` endpoint [`trendflow-py`](https://github.com/dariomory/trendflow) called before 0.2.0 — Google retired that one
along with `dailytrends` and `realtimetrends`, and all three now return 404.

- `TrendingItem` carries `growth` (percentage rise) and `volume` (relative search volume);
  `traffic` is the formatted growth, e.g. `"+3,950%"`. `articles` is always empty — this
  endpoint carries none.
- Any country code is accepted rather than a fixed list, worldwide included and the default.
- `TrendingWindow.RISING` / `.TOP` select fastest-growing versus highest-volume.
- No cookie needed, and it answers on IPs the widgetdata endpoints reject with `429`.

`geoList()` returns Google's full region hierarchy — every country with its subregions.

### Proxies and rate limits

- **Proxy pool.** `proxies: string[]` rotates through proxy URLs from any mix of providers,
  advancing on `429`, `403`, and network errors. `maxProxyAttempts` caps the retries,
  `onProxyRotate` reports them, and `currentProxy` exposes the pinned proxy. Rotation is per
  query rather than per request, because Google binds its cookie and widget token to the exit
  IP; the cookie jar is re-seeded on every rotation. Needs the optional peer dependency
  `undici`.
- A browser `User-Agent` is sent by default. Without one, Google answers the widgetdata
  endpoints with HTTP 429 regardless of request volume.
- `TooManyRequestsError` points at the rate-limit docs, since a bare "429" tells you nothing
  about the fix.

### Notes

- Higher-precision timeseries and keyword-scoped related queries on the same `batchexecute`
  endpoint are **deliberately not implemented**: they require a reCAPTCHA Enterprise token.
  The widgetdata-backed methods already cover that data.
- The `batchexecute` RPC identifiers are pinned constants. If Google renames one, calls raise
  `UnknownRpcError` and the `rpcIds` option patches it without waiting for a release.
