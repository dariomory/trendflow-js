<p align="center">
  <img src="docs/logo.png" alt="Trendflow JS logo" width="300"/>
</p>

# Trendflow JS

[![npm version](https://img.shields.io/npm/v/trendflow.svg)](https://www.npmjs.com/package/trendflow)
[![CI](https://github.com/dariomory/trendflow-js/actions/workflows/ci.yml/badge.svg)](https://github.com/dariomory/trendflow-js/actions/workflows/ci.yml)
[![docs](https://img.shields.io/badge/docs-trendflow.mory.dev-0b6e6e)](https://trendflow.mory.dev/docs/js)

A type-safe JavaScript/TypeScript library for querying and exporting Google Trends data.
The JavaScript port of [`trendflow-py`](https://github.com/dariomory/trendflow).

📖 **Documentation: [trendflow.mory.dev/docs/js](https://trendflow.mory.dev/docs/js)** — guides for
both libraries, plus a hosted MCP server for ChatGPT, Claude, and Cursor.

- GitHub: [https://github.com/dariomory/trendflow-js/](https://github.com/dariomory/trendflow-js/)
- npm package: [https://www.npmjs.com/package/trendflow](https://www.npmjs.com/package/trendflow)
- API reference: [https://dariomory.github.io/trendflow-js/](https://dariomory.github.io/trendflow-js/)
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
import { Client, Region, Timeframe, Resolution, SearchProperty, ExportFormat } from "trendflow";

// Initialize client (optional config)
const tf = new Client({ language: "en", timeout: 10_000 });

// --- Const objects for type safety ---
// Region.US, Region.GB, Region.DE ...           (or any code: "US-CA", "807")
// Timeframe.PAST_HOUR ... PAST_5_YEARS, ALL_TIME (or "2023-01-01 2023-06-30")
// Resolution.COUNTRY, Resolution.REGION, Resolution.CITY
// SearchProperty.WEB, IMAGES, NEWS, YOUTUBE, SHOPPING

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

// Related queries (region defaults to worldwide)
const related = await tf.relatedQueries("machine learning", { region: Region.GB });
for (const query of related.top) console.log(query.term, query.value);
for (const query of related.rising) console.log(query.term, query.breakout);

// --- Narrowing a query ---
// Every query method takes an optional category and search property, and any of them
// accepts a custom date range and a sub-region or metro code in place of the named values.

// "jaguar" the car, on YouTube, in California, over the first half of 2023
const jaguar = await tf.interestOverTime(["jaguar"], "2023-01-01 2023-06-30", "US-CA", {
  category: 47, // Autos & Vehicles — disambiguates without needing a topic id
  searchProperty: SearchProperty.YOUTUBE,
});

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

### Trending backends: RPC and RSS

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

### Topics and search suggestions

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
    "http://user:pass@gate.decodo.com:7000",
  ],
  maxProxyAttempts: 3, // defaults to the pool size, capped at 5
  onProxyRotate: ({ attempt, error }) => console.warn(`rotated after ${attempt}:`, error),
});

const data = await tf.interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US);
console.log(tf.currentProxy); // the proxy that answered
```

Proxy support needs [`undici`](https://github.com/nodejs/undici), an optional peer
dependency — `npm install undici`. Entries are just URLs, so a pool can mix providers. Repeating one rotating gateway also works: each entry gets its own connection, so it lands on a fresh exit IP.

**Rotation happens per query, not per request — this matters.** Google binds the `NID`
cookie and the widget token to the IP that requested them, so a single query must complete
on one exit IP; sending the follow-up `widgetdata` call from a different IP earns an instant
`429`. The pool pins one proxy for the whole query and advances only on failure, re-seeding
the cookie jar each time. For the same reason, point the pool at **sticky sessions** rather
than per-request rotating endpoints if your provider offers the choice.

Rotation is skipped for errors a different IP cannot fix, such as a `404` or the
`UnknownRpcError` raised when Google renames a `batchexecute` RPC id.

#### Where to get proxies

Residential proxies are what actually clears Google's `429`. Verified against this library:

<p align="center">
  <a href="https://dashboard.decodo.com/register?referral_code=821058adf31e1b797a169971f79daf86fd5ebbbc"><img src="docs/proxies/decodo.svg" alt="Decodo" height="56"/></a>
</p>

| Provider | Notes | Endpoint format |
|----------|-------|-----------------|
| [Decodo](https://dashboard.decodo.com/register?referral_code=821058adf31e1b797a169971f79daf86fd5ebbbc) (formerly Smartproxy) | Cheapest entry tier; pay-as-you-go available. Used to verify this library's live tests. | `http://user:pass@gate.decodo.com:7000` |

```ts
const tf = new Client({
  proxies: ["http://user:pass@gate.decodo.com:7000"],
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

## MCP server

An MCP server ships alongside the library as [`trendflow-mcp`](./mcp), so agents can query
Google Trends directly. It's a separate package — the library keeps its zero runtime
dependencies.

```bash
claude mcp add trendflow -- npx -y trendflow-mcp
```

Six tools (`search_topics`, `get_interest_over_time`, `get_interest_by_region`,
`get_related_queries`, `get_trending_now`, `research_trend`) and two resources. See
[mcp/README.md](./mcp/README.md).

## Feature Parity

Current: [`trendflow-py`](https://github.com/dariomory/trendflow) 0.2.0 · [`trendflow`](https://github.com/dariomory/trendflow-js) 0.1.0. Versions are independent; each changelog cross-references the sibling release.

| Feature | Python — [`trendflow-py`](https://pypi.org/project/trendflow-py/) | JS — [`trendflow`](https://www.npmjs.com/package/trendflow) |
|---------|:----------------------------------:|:---------------------------:|
| Interest over time | ✅ | ✅ |
| Interest by region | ✅ | ✅ |
| Trending now | ✅ | ✅ |
| Trending growth % and volume | ✅ | ✅ |
| Trending for any country code | ✅ | ✅ |
| Trending news articles (RSS) | ✅ | ✅ |
| Selectable trending backend | ✅ | ✅ |
| Related queries | ✅ | ✅ |
| Search suggestions | ✅ `suggestions()` | ✅ `suggestions()` |
| Query by topic (entity mid) | ✅ | ✅ |
| CSV / JSON export | ✅ | ✅ |
| Rotating proxy pool | ✅ | ✅ |
| Browser User-Agent by default | ✅ | ✅ |
| Full geo hierarchy | ✅ `geo_list()` | ✅ `geoList()` |
| Overridable RPC ids | ✅ | ✅ |
| pandas DataFrame | ✅ `to_dataframe()` | ❌ N/A |
| Plain-object rows | ❌ N/A | ✅ `toArray()` |
| ESM + CommonJS + types | ❌ N/A | ✅ |
| MCP server | 🔜 planned | ✅ [`trendflow-mcp`](https://www.npmjs.com/package/trendflow-mcp) |
| CLI | ✅ | 🔜 planned |

### Trending now

Google retired the `hottrends/visualize/internal/data` endpoint, along with
`api/dailytrends` and `api/realtimetrends`; all three now return HTTP 404. This library
calls the `batchexecute` RPC that trends.google.com itself uses instead — as does
[`trendflow-py`](https://github.com/dariomory/trendflow) from 0.2.0 — and it returns more
than the old endpoint did:

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

`articles` is empty on this backend — the RPC carries no article links. Pass
`{ backend: "rss" }` to get the news articles behind each trend instead.

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
