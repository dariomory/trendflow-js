---
title: Usage
---

# Usage

```ts
import { Client, Region, Timeframe, Resolution, ExportFormat } from "trendflow";

const tf = new Client({ language: "en", timeout: 10_000 });
```

`Region`, `Timeframe`, `Resolution`, and `ExportFormat` are `as const` objects, so
`Region.US` is the string `"US"` and any valid literal is accepted where the type is.

## Interest over time

```ts
const data = await tf.interestOverTime(
  ["Python", "JavaScript", "Rust"],
  Timeframe.PAST_YEAR,
  Region.US,
);

data.keywords;    // ["Python", "JavaScript", "Rust"]
data.granularity; // "weekly"
data.points;      // TrendPoint[] — { date: Date, scores: Record<string, number> }
```

## Interest by region

```ts
const regional = await tf.interestByRegion("Python", Resolution.COUNTRY, Region.US);
for (const row of regional.rows) console.log(row.label, row.value);
```

## Trending now

Runs on the `batchexecute` RPC that trends.google.com itself uses, so it needs no cookie and
is far less rate-limited than the other queries.

```ts
import { TrendingWindow } from "trendflow";

const trending = await tf.trendingNow(Region.US);
trending.results[0];
// { title: "fifa world cup 2026", growth: 3650, volume: 6, traffic: "+3,650%", articles: [] }

await tf.trendingNow(Region.US, { window: TrendingWindow.TOP }); // highest-volume instead
await tf.trendingNow("PT"); // any country code, not a fixed list
await tf.trendingNow();     // worldwide (the default)
```

`growth` is the percentage rise over the window and `volume` a relative search-volume index.
`articles` is always empty — this endpoint carries no article links; the field exists for
compatibility with [`trendflow-py`](https://github.com/dariomory/trendflow).

## Related queries

```ts
const related = await tf.relatedQueries("machine learning");
for (const q of related.top) console.log(q.term, q.value);
for (const q of related.rising) console.log(q.term, q.breakout);
```

## Exports

`InterestOverTimeResult` carries the conversion helpers. `toArray()` is the JS answer to
pandas' `to_dataframe()`.

```ts
data.toArray(); // [{ date: Date, Python: 80, ... }]
data.toJSON();  // same rows with ISO 8601 dates; also drives JSON.stringify
data.toCSV();   // CSV text

await data.export(ExportFormat.CSV, "trends.csv");   // Node only
await data.export(ExportFormat.JSON, "trends.json"); // Node only
```

In the browser use `toCSV()` / `toJSON()` — `export()` writes to disk and is Node-only.
Note that Google Trends sends no CORS headers, so calls must originate server-side.

## Errors

```ts
import { ResponseError, TooManyRequestsError, UnknownRpcError } from "trendflow";
```

- `ResponseError` — any failed request; carries `.status` and the raw `.response`.
- `TooManyRequestsError` — HTTP 429, a subclass. See [Proxies](./proxies.md).
- `UnknownRpcError` — Google renamed a `batchexecute` RPC id. Override it with the `rpcIds`
  client option rather than waiting for a release.
