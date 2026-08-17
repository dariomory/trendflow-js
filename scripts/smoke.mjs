/**
 * Live check against the real Google Trends endpoints.
 *
 *   node scripts/smoke.mjs
 *   node scripts/smoke.mjs --json
 *   TRENDFLOW_PROXY_URL=http://user:pass@host:7000 node scripts/smoke.mjs
 *   TRENDFLOW_RPC_IDS='{"trending":"wrong"}' node scripts/smoke.mjs   # prove failures are caught
 *
 * Google rate-limits most datacenter and residential IPs, so a 429 here usually means the exit
 * IP is flagged rather than that the library is broken — rerun through a proxy.
 *
 * Every check asserts what a *healthy* answer looks like rather than merely that nothing threw.
 * That distinction is the whole point: Google's related-topics widget began returning an empty
 * result instead of an error, and a check that only caught exceptions would have called it
 * healthy indefinitely.
 */
import { Client, Region, Resolution, Timeframe, TooManyRequestsError } from "../dist/index.js";
import { UnknownRpcError } from "../dist/index.js";

const asJson = process.argv.includes("--json");
const proxyUrl = process.env.TRENDFLOW_PROXY_URL;
const note = (message) => {
  if (!asJson) console.log(message);
};

/**
 * Build a fetch bound to one proxy session.
 *
 * If the URL contains `{session}` it is replaced with a fresh alphanumeric id per check, which
 * gives each check its own exit IP the way the production pool does. Without it every check
 * shares one address, and the first throttled call poisons the rest of the run.
 *
 * Alphanumeric on purpose: a sticky-session id containing a hyphen is silently truncated by
 * hyphen-delimited proxy usernames, collapsing distinct sessions onto one IP.
 */
async function makeFetch() {
  if (!proxyUrl) return undefined;
  const { ProxyAgent, fetch: undiciFetch } = await import("undici");
  const session = Math.random().toString(36).replace(/[^a-z0-9]/g, "").slice(0, 12);
  const agent = new ProxyAgent(proxyUrl.replace("{session}", session));
  return (input, init = {}) => undiciFetch(input, { ...init, dispatcher: agent });
}

note(
  proxyUrl
    ? `# routing through proxy ${new URL(proxyUrl.replace("{session}", "x")).host}`
    : "# direct connection (set TRENDFLOW_PROXY_URL to use a proxy)",
);

/** Overridable so a canary run can prove it actually detects a renamed identifier. */
let rpcIds;
if (process.env.TRENDFLOW_RPC_IDS) {
  rpcIds = JSON.parse(process.env.TRENDFLOW_RPC_IDS);
  note(`# rpc id overrides: ${JSON.stringify(rpcIds)}`);
}

/** A call that succeeded and returned nothing useful — the failure mode worth fearing. */
class DegradedError extends Error {
  constructor(message) {
    super(message);
    this.name = "DegradedError";
  }
}

const expect = (condition, message) => {
  if (!condition) throw new DegradedError(message);
};

/**
 * The outcomes need different responses, so they are named rather than lumped into "it failed".
 *
 * `rpc_renamed` covers two shapes, established by overriding ids against the live endpoint:
 *
 *   - a **well-formed id that Google no longer serves** returns HTTP **400**. This is what an
 *     actual rename looks like, because the old identifier stops existing.
 *   - a **real id that is the wrong one for this call** returns 200 with no matching frame,
 *     which is what raises `UnknownRpcError`.
 *
 * The library's error is documented as the signature of a rename, but it is the rarer half.
 * Both mean "look at the RPC id", so both are reported the same way.
 */
function classify(error) {
  if (error instanceof TooManyRequestsError) return "rate_limited";
  if (error instanceof UnknownRpcError) return "rpc_renamed";
  if (error instanceof DegradedError) return "degraded";
  // TooManyRequestsError extends ResponseError, so the 429 check above must come first.
  if (error?.name === "ResponseError" && error.status === 400) return "rpc_renamed";
  return "failed";
}

const results = [];

async function check(name, run) {
  // A client per check, so each gets its own proxy session and one throttled exit IP does not
  // cascade into the rest of the run.
  const tf = new Client({
    language: "en",
    timeout: 30_000,
    retries: 2,
    fetch: await makeFetch(),
    rpcIds,
  });
  try {
    const summary = await run(tf);
    results.push({ name, status: "ok", summary });
    note(`OK   ${name}: ${JSON.stringify(summary).slice(0, 200)}`);
  } catch (error) {
    const status = classify(error);
    const entry = { name, status, error: `${error.name}: ${error.message}` };
    if (error instanceof UnknownRpcError) entry.rpcId = error.rpcId;
    results.push(entry);
    note(`${status.toUpperCase().padEnd(13)} ${name}: ${entry.error}`);
  }
}

await check("interestOverTime", async (tf) => {
  const r = await tf.interestOverTime(["Python", "JavaScript"], Timeframe.PAST_YEAR, Region.US);
  // A year of weekly points is ~52. Well under that means a truncated or empty series.
  expect(r.points.length >= 40, `expected >=40 weekly points, got ${r.points.length}`);
  expect(r.granularity === "weekly", `expected weekly granularity, got ${r.granularity}`);
  const scores = r.points.flatMap((p) => Object.values(p.scores));
  expect(
    scores.some((v) => v > 0),
    "every point scored zero — the series carries no signal",
  );
  expect(
    scores.every((v) => v >= 0 && v <= 100),
    "scores outside 0-100, so the value scale has changed",
  );
  return { granularity: r.granularity, points: r.points.length };
});

await check("interestByRegion", async (tf) => {
  const r = await tf.interestByRegion("Python", Resolution.COUNTRY, Region.US);
  expect(r.rows.length > 0, "no regional rows returned");
  expect(
    r.rows.every((row) => typeof row.label === "string" && row.label.length > 0),
    "rows returned without labels, so the response shape has changed",
  );
  expect(
    r.rows.every((row) => row.value >= 0 && row.value <= 100),
    "row values outside 0-100, so the value scale has changed",
  );
  return { rows: r.rows.length, top: r.rows[0]?.label };
});

await check("relatedQueries", async (tf) => {
  const r = await tf.relatedQueries("machine learning", { region: Region.US });
  // This is exactly how related *topics* broke: a clean response carrying nothing.
  expect(r.top.length > 0, "no top related queries — the widget returned an empty ranked list");
  expect(
    r.top.every((q) => typeof q.term === "string" && q.term.length > 0),
    "related queries returned without terms, so the response shape has changed",
  );
  return { top: r.top.length, rising: r.rising.length, sample: r.top[0]?.term };
});

/**
 * Pinned to the RPC backend on purpose.
 *
 * The default `"auto"` falls back to the RSS feed when the RPC fails, which is right for users
 * and useless for a canary: a renamed RPC id is absorbed by the fallback and the check passes
 * with `source: "rss"`. Verified by overriding the id with a deliberately wrong value — `auto`
 * reported healthy. Naming the backend is what makes a renamed id surface as UnknownRpcError.
 */
await check("trendingNow (rpc)", async (tf) => {
  const r = await tf.trendingNow(Region.US, { backend: "rpc" });
  expect(r.source === "rpc", `expected the rpc backend, got ${r.source}`);
  expect(r.results.length > 0, "no trending results returned");
  expect(
    r.results.every((item) => typeof item.title === "string" && item.title.length > 0),
    "trending items returned without titles, so the response shape has changed",
  );
  return { source: r.source, count: r.results.length, sample: r.results[0]?.title };
});

/** The independent path. It is the fallback, so it has to be known-good in its own right. */
await check("trendingNow (rss)", async (tf) => {
  const r = await tf.trendingNow(Region.US, { backend: "rss" });
  expect(r.source === "rss", `expected the rss backend, got ${r.source}`);
  expect(r.results.length > 0, "no trending results returned from the feed");
  return { source: r.source, count: r.results.length };
});

await check("suggestions", async (tf) => {
  const r = await tf.suggestions("artificial intelligence");
  expect(r.length > 0, "no topic suggestions returned");
  expect(
    r.some((t) => typeof t.mid === "string" && t.mid.startsWith("/")),
    "suggestions carry no topic ids, so the response shape has changed",
  );
  return { count: r.length, sample: r[0]?.mid };
});

await check("geoList", async (tf) => {
  const raw = await tf.geoList();
  const countries = Array.isArray(raw) ? raw[0] : undefined;
  expect(Array.isArray(countries), "geo list is not the expected [countries, detected] shape");
  expect(countries.length > 100, `expected >100 countries, got ${countries?.length}`);
  return { countries: countries.length };
});

const failures = results.filter((r) => r.status !== "ok");
// A flagged exit IP is an environment problem, not a library problem, so throttling must not
// turn the canary red every time Google refuses a shared address.
const realFailures = failures.filter((r) => r.status !== "rate_limited");
const passed = results.filter((r) => r.status === "ok");

/**
 * Nothing succeeded and nothing genuinely failed — every answer was a 429.
 *
 * Reporting that as green would be worse than reporting nothing, because a vacuous pass is
 * indistinguishable from a healthy run. Exit 2 so the workflow retries rather than believes it.
 */
const inconclusive = passed.length === 0 && realFailures.length === 0;

if (asJson) {
  console.log(
    JSON.stringify(
      { ok: realFailures.length === 0 && !inconclusive, inconclusive, results },
      null,
      2,
    ),
  );
} else {
  if (failures.length > 0) note(`\n# ${failures.length} of ${results.length} checks failed`);
  if (inconclusive) note("# INCONCLUSIVE — every check was rate limited, nothing was verified");
}

if (inconclusive) process.exit(2);
process.exit(realFailures.length > 0 ? 1 : 0);
