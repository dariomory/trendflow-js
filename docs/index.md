<p align="center">
  <img src="./logo.png" alt="Trendflow JS logo" width="300"/>
</p>

# Trendflow JS

A type-safe JavaScript/TypeScript library for querying and exporting Google Trends data.
The JavaScript port of [`trendflow-py`](https://github.com/dariomory/trendflow).

```bash
npm install trendflow
```

Requires Node.js 18+. Ships ESM and CommonJS with bundled type declarations.

```ts
import { Client, Region, Timeframe } from "trendflow";

const tf = new Client();

const data = await tf.interestOverTime(["Python", "Rust"], Timeframe.PAST_YEAR, Region.US);
console.log(data.granularity, data.points.length);

const trending = await tf.trendingNow(Region.US);
console.log(trending.results[0]); // { title, growth, volume, traffic, articles }
```

## Where to go next

- **[Usage](./usage.md)** — every query, the result models, and the export helpers.
- **[Proxies and rate limits](./proxies.md)** — why Google returns `429`, and the proxy pool.
- **API reference** — generated from the source; see the navigation sidebar.

## Feature parity with [`trendflow-py`](https://github.com/dariomory/trendflow)

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
| CLI | ✅ | 🔜 planned |
