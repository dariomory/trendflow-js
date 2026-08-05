<p align="center">
  <img src="./logo.png" alt="Trendflow logo" width="300"/>
</p>

# Trendflow JS

A type-safe JavaScript/TypeScript library for querying and exporting Google Trends data.
The JavaScript port of [trendflow-py](https://github.com/dariomory/trendflow).

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

## Feature parity with `trendflow-py`

| Feature | Python (`trendflow-py`) | JS (`trendflow`) |
|---------|:----------------------:|:----------------:|
| Interest over time | ✅ | ✅ |
| Interest by region | ✅ | ✅ |
| Trending now | ✅ | ✅ |
| Trending growth %/volume | ✅ | ✅ |
| Related queries | ✅ | ✅ |
| CSV/JSON export | ✅ | ✅ |
| Proxy pool | ✅ | ✅ |
| pandas DataFrame | ✅ | ❌ N/A |
| Plain-object rows | ❌ N/A | ✅ `toArray()` |
| CLI | ✅ | 🔜 planned |
