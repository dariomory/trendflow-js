<p align="center">
  <img src="docs/logo.png" alt="Trendflow JS logo" width="300"/>
</p>

# Trendflow JS

[![npm version](https://img.shields.io/npm/v/trendflow.svg)](https://www.npmjs.com/package/trendflow)
[![CI](https://github.com/dariomory/trendflow-js/actions/workflows/ci.yml/badge.svg)](https://github.com/dariomory/trendflow-js/actions/workflows/ci.yml)
[![docs](https://img.shields.io/badge/docs-github.io-blue)](https://dariomory.github.io/trendflow-js/)

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

Requires Node.js 18+ (uses the global `fetch`). Ships ESM and CommonJS with bundled type declarations.

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

// Trending searches right now (any country code, or omit for worldwide)
const trending = await tf.trendingNow(Region.US);
for (const item of trending.results) {
  console.log(item.title, item.growth, item.volume, item.traffic);
  // "fifa world cup 2026"  3650  6  "+3,650%"
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

<a id="rate-limits"></a>
### Rate limits

Google Trends aggressively rate-limits datacenter and shared IPs, so `429` is common even on
your first request of the day. Two things matter:

1. **User-Agent.** Google returns `429` to the default agent strings Node HTTP clients send,
   no matter how few requests you have made. This library sends a browser User-Agent by
   default for exactly that reason — if you override `headers`, keep a realistic one.
2. **IP reputation.** Once an IP is flagged, every request gets `429` regardless of headers.
   Route through a residential proxy to recover.

### Using a proxy pool

Pass a list of proxy URLs and the client rotates through them automatically, moving to the
next one whenever a query is refused:

```ts
import { Client, Region, Timeframe } from "trendflow";

const tf = new Client({
  proxies: [
    "http://user:pass@gate.decodo.com:7000",
    "http://user:pass@pr.oxylabs.io:7777",
    "http://user:pass@brd.superproxy.io:22225",
  ],
  maxProxyAttempts: 3, // defaults to the pool size, capped at 5
  onProxyRotate: ({ attempt, error }) => console.warn(`rotated after ${attempt}:`, error),
});

const data = await tf.interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US);
console.log(tf.currentProxy); // the proxy that answered
```

Proxy support needs [`undici`](https://github.com/nodejs/undici), an optional peer
dependency — `npm install undici`. Mixing providers in one pool is fine; they are just URLs.

**Rotation happens per query, not per request — this matters.** Google binds the `NID`
cookie and the widget token to the IP that requested them, so a single query must complete
on one exit IP; sending the follow-up `widgetdata` call from a different IP earns an instant
`429`. The pool pins one proxy for the whole query and advances only on failure, re-seeding
the cookie jar each time. For the same reason, point the pool at **sticky sessions** rather
than per-request rotating endpoints if your provider offers the choice.

Rotation is skipped for errors a different IP cannot fix, such as a `404` or the
`UnknownRpcError` raised when Google renames a `batchexecute` RPC id.

#### Where to get proxies

Residential proxies are what actually clears Google's `429`. Two providers verified against
this library:

| Provider | Notes | Endpoint format |
|----------|-------|-----------------|
| [Decodo](https://decodo.com/) (formerly Smartproxy) | Cheapest entry tier; pay-as-you-go available. Used to verify this library's live tests. | `http://user:pass@gate.decodo.com:7000` |
| [Oxylabs](https://oxylabs.io/) | Larger pool and better Google success rates; enterprise pricing. | `http://user:pass@pr.oxylabs.io:7777` |

```ts
const tf = new Client({
  proxies: [
    "http://user:pass@gate.decodo.com:7000", // Decodo
    "http://user:pass@pr.oxylabs.io:7777",   // Oxylabs
  ],
});
```

Ask for **sticky sessions** when you sign up — per-request rotating endpoints break the
cookie/token binding described above. Note that a shared residential pool can be exhausted
for Google Trends specifically, in which case even a valid proxy returns `429`; that is what
`maxProxyAttempts` is for.

#### Bringing your own client

For logging, caching, or custom routing, pass a `fetch` instead (mutually exclusive with
`proxies` — the library will tell you if you pass both):

```ts
import { ProxyAgent, fetch as undiciFetch } from "undici";

const agent = new ProxyAgent("http://user:pass@proxy.example.com:7000");
const tf = new Client({
  fetch: ((input, init = {}) =>
    undiciFetch(input, { ...init, dispatcher: agent })) as typeof globalThis.fetch,
});
```

### Browser / Next.js

Every method except `export()` works anywhere `fetch` does, but Google Trends sends no CORS
headers — calls from browser JavaScript will be blocked. Use this library server-side
(Route Handlers, Server Actions, API routes) and pass results to the client.

## Feature Parity

| Feature               | Python (`trendflow-py`) | JS (`trendflow`) |
|-----------------------|:-----------------------:|:----------------:|
| Interest over time    | ✅                      | ✅               |
| Interest by region    | ✅                      | ✅               |
| Trending now          | ❌ [†](#trending-now)   | ✅ [†](#trending-now) |
| Trending growth %/volume | ❌ N/A               | ✅               |
| Any country code      | ❌ 16 hardcoded         | ✅ all           |
| Related queries       | ✅                      | ✅               |
| CSV/JSON export       | ✅                      | ✅               |
| Proxy support         | ✅                      | ✅               |
| Automatic proxy pool  | ❌ N/A                  | ✅               |
| pandas DataFrame      | ✅                      | ❌ N/A           |
| Plain-object rows     | ❌ N/A                  | ✅ `toArray()`   |
| CLI                   | ✅                      | 🔜 planned       |

<a id="trending-now"></a>
† Google retired the `hottrends/visualize/internal/data` endpoint, along with
`api/dailytrends` and `api/realtimetrends`; all three now return HTTP 404, which is why
`trending_now()` is broken in `trendflow-py`. This library instead calls the
`batchexecute` RPC that trends.google.com itself uses, so `trendingNow()` works — and
returns more than the old endpoint did:

```ts
const trending = await tf.trendingNow(Region.US);
// { title: "fifa world cup 2026", growth: 3650, volume: 6, traffic: "+3,650%", articles: [] }
```

Three practical wins over the old endpoint:

- **Growth and volume**, not just titles. `growth` is the percentage rise over the window,
  `volume` a relative search-volume index.
- **Any country code**, not the 16 hardcoded names the old endpoint required — and
  worldwide works, which it previously refused.
- **No cookie, and far looser rate limiting.** This RPC answers on IPs that get a `429`
  from the widgetdata endpoints, so `trendingNow()` often works with no proxy at all.

`articles` is always empty — this endpoint carries no article links. The field is kept for
compatibility with `trendflow-py`.

The window is selectable via `TrendingWindow`:

```ts
import { TrendingWindow } from "trendflow";

await tf.trendingNow(Region.US, { window: TrendingWindow.RISING }); // default: fastest-growing
await tf.trendingNow(Region.US, { window: TrendingWindow.TOP });    // highest-volume
```

`window` is an undocumented Google parameter. Only these two values have behaviour worth
naming; other integers between 4 and 12 also return data over varying recency windows, and
you can pass one as a raw number.

#### Not implemented: captcha-gated RPCs

The same `batchexecute` endpoint exposes a higher-precision timeseries (floating-point
values rather than the rounded 0-100 the public API returns) and keyword-scoped related
queries. Both require a reCAPTCHA Enterprise token and return an empty payload without one,
so this library does not implement them — that data remains available through
`interestOverTime()` and `relatedQueries()`, which use the documented widgetdata endpoints.

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

npm test        # vitest — 60 tests, fully offline against a stubbed fetch
npm run qa      # typecheck + test + build
```

The unit tests never touch the network. To check the real endpoints:

```bash
npm run build && npm run smoke
TRENDFLOW_PROXY_URL=http://user:pass@host:7000 npm run smoke   # via a proxy
```

## Author

Trendflow JS was created in 2026 by Dario Mory.
