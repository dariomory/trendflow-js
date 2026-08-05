# Changelog

## Unreleased

- **Proxy pool.** `proxies: string[]` rotates through a list of proxy URLs from any mix of
  providers, advancing on `429`, `403`, and network errors. `maxProxyAttempts` caps the
  retries, `onProxyRotate` reports them, and `currentProxy` exposes the pinned proxy.
  Rotation is per query rather than per request, because Google binds its cookie and widget
  token to the exit IP; the cookie jar is re-seeded on every rotation. Needs the optional
  peer dependency `undici`. This is beyond `trendflow-py`, which rotates per request.
- `TooManyRequestsError` now points at the rate-limit docs, since a bare "429" tells you
  nothing about the fix.
- Proxy provider recommendations in the README, with affiliate links and a disclosure.
  See `AFFILIATES.md` — the IDs are placeholders until replaced.

## 0.1.0

Initial release — the JavaScript/TypeScript port of [trendflow-py](https://github.com/dariomory/trendflow).

Reaches feature parity with `trendflow-py` 0.1.1 for the core queries:

- `interestOverTime()`, `interestByRegion()`, `trendingNow()`, `relatedQueries()`
- `Region`, `Timeframe`, `Resolution`, `ExportFormat` as `as const` objects
- `InterestOverTimeResult.toArray()` / `toJSON()` / `toCSV()`, plus Node-only `export()`
- `ResponseError` / `TooManyRequestsError`
- Injectable `fetch` for proxies, logging, and tests

Not ported: the pandas `to_dataframe()` bridge (`toArray()` replaces it) and the CLI.

Two behaviours worth knowing, both verified against live Google Trends:

- A browser `User-Agent` is sent by default. Without one Google answers the widgetdata
  endpoints with HTTP 429 regardless of request volume.
- `trendingNow()` throws `ResponseError` (404): Google retired the endpoint it depends on.
  The same break affects `trendflow-py`. See the README for details.
