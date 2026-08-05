/**
 * Live check against the real Google Trends endpoints.
 *
 *   node scripts/smoke.mjs
 *   TRENDFLOW_PROXY_URL=http://user:pass@host:7000 node scripts/smoke.mjs
 *
 * Google rate-limits most datacenter and residential IPs, so a 429 here usually means the
 * exit IP is flagged rather than that the library is broken — rerun through a proxy.
 */
import { Client, Region, Resolution, Timeframe } from "../dist/index.js";

const proxyUrl = process.env.TRENDFLOW_PROXY_URL;
let fetchImpl;

if (proxyUrl) {
  const { ProxyAgent, fetch: undiciFetch } = await import("undici");
  const agent = new ProxyAgent(proxyUrl);
  fetchImpl = (input, init = {}) => undiciFetch(input, { ...init, dispatcher: agent });
  console.log(`# routing through proxy ${new URL(proxyUrl).host}`);
} else {
  console.log("# direct connection (set TRENDFLOW_PROXY_URL to use a proxy)");
}

const tf = new Client({ language: "en", timeout: 30_000, retries: 2, fetch: fetchImpl });
let failed = 0;

async function step(name, fn) {
  try {
    console.log(`OK   ${name}:`, JSON.stringify(await fn()).slice(0, 240));
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.name}: ${error.message}`);
  }
}

await step("interestOverTime", async () => {
  const r = await tf.interestOverTime(["Python", "JavaScript"], Timeframe.PAST_YEAR, Region.US);
  return { granularity: r.granularity, points: r.points.length, first: r.points[0] };
});

await step("interestByRegion", async () => {
  const r = await tf.interestByRegion("Python", Resolution.COUNTRY, Region.US);
  return { rows: r.rows.length, sample: r.rows.slice(0, 3) };
});

await step("relatedQueries", async () => {
  const r = await tf.relatedQueries("machine learning");
  return { top: r.top.slice(0, 2), rising: r.rising.slice(0, 2) };
});

await step("trendingNow", async () => {
  const r = await tf.trendingNow(Region.US);
  return { count: r.results.length, sample: r.results.slice(0, 3).map((i) => `${i.title} ${i.traffic}`) };
});

process.exit(failed > 0 ? 1 : 0);
