/**
 * Client for Google Trends' `batchexecute` RPC endpoint — the transport behind the current
 * trends.google.com UI, which replaced the retired `hottrends` / `dailytrends` endpoints.
 *
 * Only the RPCs that answer anonymously are used here. Keyword-scoped RPCs on this endpoint
 * (per-term timeseries and related queries) additionally require a reCAPTCHA Enterprise
 * token and return an empty payload without one; this library reaches that data through the
 * documented widgetdata endpoints instead. See `session.ts`.
 */
import { BATCH_EXECUTE } from "./endpoints.js";
import { ResponseError, TooManyRequestsError } from "./errors.js";
import { HTTP_TOO_MANY_REQUESTS } from "./endpoints.js";

/** `fXqlme`: rising/top searches. With an empty keyword it returns trending searches. */
export const RPC_TRENDING = "fXqlme";
/** `DqDTgb`: the full geo hierarchy — every country with its subregions. */
export const RPC_GEO_LIST = "DqDTgb";

/** One `[term, growthPercent, volumeIndex]` row from the trending RPC. */
export type TrendingRow = [string, number, number];

export interface BatchExecuteOptions {
  hl: string;
  timeout: number;
  headers: Record<string, string>;
  fetch: typeof globalThis.fetch;
}

/**
 * Unwrap the chunked envelope Google wraps RPC responses in:
 * `)]}'` then repeating `<length>\n<json>` frames, where the payload we want sits inside a
 * `["wrb.fr", <rpcid>, "<json string>"]` frame.
 */
export function parseBatchExecute(text: string, rpcId: string): unknown {
  let result: unknown;
  for (const line of text.replace(/^\)\]\}'\n?/, "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[")) continue;
    let frames: unknown;
    try {
      frames = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!Array.isArray(frames)) continue;
    for (const frame of frames) {
      if (!Array.isArray(frame) || frame[0] !== "wrb.fr") continue;
      if (frame[1] !== rpcId || typeof frame[2] !== "string") continue;
      try {
        result = JSON.parse(frame[2]);
      } catch {
        /* leave `result` as-is; a malformed frame is treated as no data */
      }
    }
  }
  return result;
}

export class BatchExecuteClient {
  private readonly hl: string;
  private readonly timeout: number;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: BatchExecuteOptions) {
    this.hl = options.hl;
    this.timeout = options.timeout;
    this.headers = options.headers;
    this.fetchImpl = options.fetch;
  }

  /** Invoke one RPC and return its decoded payload. */
  async call(rpcId: string, payload: unknown): Promise<unknown> {
    const url = new URL(BATCH_EXECUTE);
    url.searchParams.set("rpcids", rpcId);
    url.searchParams.set("source-path", "/explore");
    url.searchParams.set("hl", this.hl);
    url.searchParams.set("soc-app", "1");
    url.searchParams.set("soc-platform", "1");
    url.searchParams.set("soc-device", "1");
    url.searchParams.set("_reqid", String(Math.floor(Math.random() * 900_000) + 100_000));
    url.searchParams.set("rt", "c");

    const body = new URLSearchParams({
      "f.req": JSON.stringify([[[rpcId, JSON.stringify(payload), null, "generic"]]]),
    });

    const response = await this.fetchImpl(url.toString(), {
      method: "POST",
      headers: {
        ...this.headers,
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-same-domain": "1",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      throw TooManyRequestsError.fromResponse(response);
    }
    if (response.status !== 200) {
      throw ResponseError.fromResponse(response);
    }
    return parseBatchExecute(await response.text(), rpcId);
  }

  /**
   * Trending searches for a geo. `geo` is `"Worldwide"` or a country code such as `"US"`.
   * `window` is Google's own undocumented recency selector; see `TRENDING_WINDOW`.
   */
  async trendingSearches(geo: string, window: number): Promise<TrendingRow[]> {
    const data = await this.call(RPC_TRENDING, [
      [[geo, "", window, null, 2]],
      1,
      this.hl,
      null,
      null,
      0,
    ]);
    const rows = (data as any)?.[0]?.[0]?.[1];
    return Array.isArray(rows) ? (rows as TrendingRow[]) : [];
  }

  /** The full geo hierarchy: `[code, name, slug]` per country, each with its subregions. */
  async geoList(): Promise<unknown> {
    return this.call(RPC_GEO_LIST, [this.hl, 1, 1]);
  }
}
