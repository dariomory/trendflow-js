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
`articles` is empty on this backend — the RPC carries no article links. Pass
`{ backend: "rss" }` to get the news articles behind each trend instead.

## Related queries

```ts
const related = await tf.relatedQueries("machine learning");
for (const q of related.top) console.log(q.term, q.value);
for (const q of related.rising) console.log(q.term, q.breakout);
```

## Trending backends: RPC and RSS

Google exposes trending searches two ways. They are not interchangeable, so `backend` lets
you pick:

| | `"rpc"` (`batchexecute`) | `"rss"` (feed) |
|---|---|---|
| items | 50 | 10 |
| payload | ~2 KB JSON | ~21 KB XML |
| growth % and volume | ✅ | ❌ — buckets like `"2000+"` |
| news articles | ❌ | ✅ |
| `window` selection | ✅ | ignored by Google |
| worldwide | ✅ | ❌ country only |

```ts
const rss = await tf.trendingNow(Region.US, { backend: "rss" });
rss.source; // "rss"
rss.results[0].articles;
// [{ title: "...", url: "https://...", source: "Buffalo News", picture: "https://..." }]
```

`"auto"` (the default) tries the RPC and falls back to the feed. The RPC comes first
deliberately: it returns five times the items with real growth figures, so defaulting to RSS
would quietly degrade results. Reach for `"rss"` when you want the **articles** — that is the
one thing the RPC cannot give you — or as a second opinion if the RPC id ever goes stale.

Note that the feed is not a lighter path despite being a feed, and Google ignores `hours`,
`sort` and `count` on it: it always returns the same 10 entries.

## Topics and search suggestions

Google distinguishes a **search term** (the literal string) from a **topic** (the entity, in
every spelling and language). `suggestions()` finds the topic; every query method already
accepts one — pass the `mid` where you would pass a keyword.

```ts
const topics = await tf.suggestions("artificial intelligence");
// [{ mid: "/m/0mkz", title: "Artificial intelligence", type: "Professional field" }]

const data = await tf.interestOverTime(
  [topics[0].mid, "artificial intelligence"],
  Timeframe.PAST_YEAR,
  Region.US,
);
// { "/m/0mkz": 62, "artificial intelligence": 1 }
```

That gap is the point: the topic scores **62** where the literal phrase scores **1**, because
it aggregates every phrasing and translation people actually search.

`suggestions()` needs no cookie and no proxy — it answers on IPs the widgetdata endpoints
reject with `429`, same as `trendingNow()`. `type` disambiguates same-name entities
(`"Nike"` returns both the company and the goddess) and is `null` when Google omits it.

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
