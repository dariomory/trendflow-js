<p align="center">
  <img src="./logo.png" alt="Trendflow JS logo" width="300"/>
</p>

# Trendflow JS — API reference

Every class, method, and type in [`trendflow`](https://www.npmjs.com/package/trendflow),
generated from the TypeScript source on each commit. Use the sidebar to browse, or search.

**Looking for guides?** The full documentation — installation, usage, trending backends,
topics, proxies and rate limits — lives at
**[trendflow.mory.dev/docs/js](https://trendflow.mory.dev/docs/js)**, alongside the
[Python documentation](https://trendflow.mory.dev/docs/python) and the
[hosted MCP server](https://trendflow.mory.dev/docs/mcp).

```bash
npm install trendflow
```

Node.js 18+. Ships ESM and CommonJS with bundled type declarations.

## Start here

- {@link GoogleTrendsFetcher} (exported as `Client`) — the only class you construct. Every
  query hangs off it.
- {@link ClientOptions} — language, timeout, proxies, and the escape hatches for a custom
  `fetch` or renamed RPC ids.
- {@link InterestOverTimeResult} — the timeseries model, with `toArray()`, `toCSV()`, and
  `export()`.
- {@link ResponseError} / {@link TooManyRequestsError} — what a `429` means, and when rotating
  an exit IP will help.

## Links

- Guides and canonical documentation: [trendflow.mory.dev](https://trendflow.mory.dev)
- Source: [github.com/dariomory/trendflow-js](https://github.com/dariomory/trendflow-js)
- Package: [npmjs.com/package/trendflow](https://www.npmjs.com/package/trendflow)
- Python sibling: [`trendflow-py`](https://pypi.org/project/trendflow-py/)
- MIT licensed, by [Dario Mory](https://mory.dev)
