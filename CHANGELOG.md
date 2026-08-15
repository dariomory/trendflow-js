# Changelog

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
