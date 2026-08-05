---
title: Proxies and rate limits
---

# Proxies and rate limits

Google Trends aggressively rate-limits datacenter and shared IPs, so `429` is common even on
your first request of the day. Two things matter:

1. **User-Agent.** Google returns `429` to the default agent strings Node HTTP clients send,
   no matter how few requests you have made. This library sends a browser User-Agent by
   default for exactly that reason — if you override `headers`, keep a realistic one.
2. **IP reputation.** Once an IP is flagged, every request gets `429` regardless of headers.
   Route through a residential proxy to recover.

`trendingNow()` is the exception: it runs on a different endpoint that answers on IPs the
others reject, so it often works with no proxy at all.

## The proxy pool

```ts
import { Client, Region, Timeframe } from "trendflow";

const tf = new Client({
  proxies: [
    "http://user:pass@gate.decodo.com:7000",
    "http://user:pass@pr.oxylabs.io:7777",
  ],
  maxProxyAttempts: 3, // defaults to the pool size, capped at 5
  onProxyRotate: ({ attempt, error }) => console.warn(`rotated after ${attempt}:`, error),
});

const data = await tf.interestOverTime(["Python"], Timeframe.PAST_YEAR, Region.US);
console.log(tf.currentProxy); // the proxy that answered
```

Proxy support needs [`undici`](https://github.com/nodejs/undici), an optional peer
dependency — `npm install undici`. Mixing providers in one pool is fine; they are just URLs.

## Rotation is per query, not per request

This is the part that trips people up. Google binds the `NID` cookie **and** the widget token
to the IP that requested them. A single query is several HTTP requests, and if the follow-up
`widgetdata` call leaves from a different exit IP than the one that got the token, Google
answers `429` immediately.

So the pool pins one proxy for the whole of a query and advances only when that query fails,
re-seeding the cookie jar each time. Two consequences:

- **Use sticky sessions.** If your provider offers both, point the pool at a sticky session
  endpoint, never a per-request rotating one.
- **Rotation is skipped for errors a new IP cannot fix** — a `404`, or an `UnknownRpcError`
  from a renamed RPC id. Rotating on those would just burn the pool.

## Where to get proxies

Residential proxies are what actually clears Google's `429`. Two providers verified against
this library:

| Provider | Notes | Endpoint format |
|----------|-------|-----------------|
| [Decodo](https://decodo.com/?ref=REPLACE_WITH_DECODO_AFFILIATE_ID) (formerly Smartproxy) | Cheapest entry tier; pay-as-you-go available. Used to verify this library's live tests. | `http://user:pass@gate.decodo.com:7000` |
| [Oxylabs](https://oxylabs.io/?ref=REPLACE_WITH_OXYLABS_AFFILIATE_ID) | Larger pool and better Google success rates; enterprise pricing. | `http://user:pass@pr.oxylabs.io:7777` |

A shared residential pool can be exhausted for Google Trends specifically, in which case even
a valid proxy returns `429` — that is what `maxProxyAttempts` is for.

> **Disclosure:** the two provider links above are affiliate links — this project may earn a
> commission if you sign up through them, at no extra cost to you. They are recommended
> because they were actually tested against this library, and the plain endpoint formats are
> listed so you can use any provider, or none.

## Bringing your own client

For logging, caching, or custom routing, pass a `fetch` instead (mutually exclusive with
`proxies`):

```ts
import { ProxyAgent, fetch as undiciFetch } from "undici";

const agent = new ProxyAgent("http://user:pass@proxy.example.com:7000");
const tf = new Client({
  fetch: ((input, init = {}) =>
    undiciFetch(input, { ...init, dispatcher: agent })) as typeof globalThis.fetch,
});
```
