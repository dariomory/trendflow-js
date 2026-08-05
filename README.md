# Trendflow JS

[![npm version](https://img.shields.io/npm/v/trendflow.svg)](https://www.npmjs.com/package/trendflow)

A type-safe JavaScript/TypeScript library for querying and exporting Google Trends data.
The JavaScript port of [trendflow-py](https://github.com/dariomory/trendflow).

- GitHub: [https://github.com/dariomory/trendflow-js/](https://github.com/dariomory/trendflow-js/)
- npm package: [https://www.npmjs.com/package/trendflow](https://www.npmjs.com/package/trendflow)
- Python sibling: [https://pypi.org/project/trendflow-py/](https://pypi.org/project/trendflow-py/)
- Created by: **[Dario Mory](https://mory.dev)** | GitHub [https://github.com/dariomory](https://github.com/dariomory)
- Free software: MIT License

## Install

```bash
npm install trendflow
```

Requires Node.js 18+ (uses the global `fetch`). Ships ESM with bundled type declarations.

## Usage

```ts
import { Client, Region, Timeframe, Resolution, ExportFormat } from "trendflow";

// Initialize client (optional config)
const tf = new Client({ language: "en", timeout: 10_000 });

// --- Const objects for type safety ---
// Region.US, Region.GB, Region.DE ...
// Timeframe.PAST_DAY, Timeframe.PAST_WEEK, Timeframe.PAST_YEAR, Timeframe.PAST_5_YEARS
// Resolution.COUNTRY, Resolution.REGION, Resolution.CITY

// Fetch interest over time
const data = await tf.interestOverTime(
  ["Python", "JavaScript", "Rust"],
  Timeframe.PAST_YEAR,
  Region.US,
);

console.log(data.keywords);    // ["Python", "JavaScript", "Rust"]
console.log(data.granularity); // "weekly"
console.log(data.points);      // TrendPoint[] — { date: Date, scores: Record<string, number> }

// Regional breakdown (region defaults to Region.US)
const regional = await tf.interestByRegion("Python", Resolution.COUNTRY);
for (const row of regional.rows) {
  console.log(row.label, row.value);
}

// Trending searches right now
const trending = await tf.trendingNow(Region.US);
for (const item of trending.results) {
  console.log(item.title, item.traffic, item.articles);
}

// Related queries
const related = await tf.relatedQueries("machine learning");
for (const query of related.top) console.log(query.term, query.value);
for (const query of related.rising) console.log(query.term, query.breakout);

// --- Exports ---
data.toArray();  // [{ date: Date, Python: 80, ... }] — plain objects, the JS answer to DataFrames
data.toJSON();   // same rows with ISO 8601 date strings (also drives JSON.stringify)
data.toCSV();    // CSV text

// Node.js only — writes UTF-8 to disk
await data.export(ExportFormat.CSV, "trends.csv");
await data.export(ExportFormat.JSON, "trends.json");
```

### Errors

Failed requests throw `ResponseError`, or `TooManyRequestsError` (a subclass) on HTTP 429.
Both carry `.status` and the raw `.response`.

```ts
import { TooManyRequestsError } from "trendflow";

try {
  await tf.interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US);
} catch (error) {
  if (error instanceof TooManyRequestsError) {
    // Google is rate-limiting this IP — back off and retry later.
  }
}
```

Google Trends aggressively rate-limits datacenter and shared IPs. `429` is a fact of life
with this API, not a bug in the client.

### Browser / Next.js

Every method except `export()` works anywhere `fetch` does, but Google Trends sends no CORS
headers — calls from browser JavaScript will be blocked. Use this library server-side
(Route Handlers, Server Actions, API routes) and pass results to the client.

## Feature Parity

| Feature               | Python (`trendflow-py`) | JS (`trendflow`) |
|-----------------------|:-----------------------:|:----------------:|
| Interest over time    | ✅                      | ✅               |
| Interest by region    | ✅                      | ✅               |
| Trending now          | ✅                      | ✅               |
| Related queries       | ✅                      | ✅               |
| CSV/JSON export       | ✅                      | ✅               |
| pandas DataFrame      | ✅                      | ❌ N/A           |
| Plain-object rows     | ❌ N/A                  | ✅ `toArray()`   |
| CLI                   | ✅                      | 🔜 planned       |

### API mapping

| Python                  | JavaScript             |
|-------------------------|------------------------|
| `interest_over_time()`  | `interestOverTime()`   |
| `interest_by_region()`  | `interestByRegion()`   |
| `trending_now()`        | `trendingNow()`        |
| `related_queries()`     | `relatedQueries()`     |
| `to_dataframe()`        | `toArray()`            |
| `export(fmt, path)`     | `export(fmt, path)` — Node only, plus `toCSV()` / `toJSON()` |

Notable differences:

- **Everything is async.** All four query methods return promises.
- **`timeout` is milliseconds** (JS convention), not seconds.
- **Enums are `as const` objects**, so `Region.US` is the string `"US"` and any valid
  string literal is accepted where the type is expected.
- **Results are plain typed objects.** Only `InterestOverTimeResult` is a class, because it
  carries the conversion methods; the rest are interfaces.

## Development

```bash
git clone git@github.com:dariomory/trendflow-js.git
cd trendflow-js
npm install

npm test        # vitest
npm run qa      # typecheck + test + build
```

## Author

Trendflow JS was created in 2026 by Dario Mory.
