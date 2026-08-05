# Changelog

## 0.1.0

Initial release — the JavaScript/TypeScript port of [trendflow-py](https://github.com/dariomory/trendflow).

Reaches feature parity with `trendflow-py` 0.1.1 for the four core queries:

- `interestOverTime()`, `interestByRegion()`, `trendingNow()`, `relatedQueries()`
- `Region`, `Timeframe`, `Resolution`, `ExportFormat` as `as const` objects
- `InterestOverTimeResult.toArray()` / `toJSON()` / `toCSV()`, plus Node-only `export()`
- `ResponseError` / `TooManyRequestsError`

Not ported: the pandas `to_dataframe()` bridge (`toArray()` replaces it) and the CLI.
