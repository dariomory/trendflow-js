import type { Resolution } from "./enums.js";
import {
  InterestOverTimeResult,
  type InterestByRegionResult,
  type RegionalInterestRow,
  type RelatedQuery,
  type RelatedResult,
  type TrendingItem,
  type TrendingResult,
  type TrendPoint,
} from "./models.js";

/** A `rankedKeyword` row as returned by the relatedsearches widget. */
export interface RankedKeyword {
  query?: unknown;
  value?: unknown;
  formattedValue?: unknown;
  [key: string]: unknown;
}

export type RelatedQueriesRaw = Record<
  string,
  { top?: RankedKeyword[] | null; rising?: RankedKeyword[] | null }
>;

const MS_PER_DAY = 86_400_000;

/** Parse Google's `"[12,0]"` value strings, keeping positions so index → keyword stays aligned. */
function splitBracketedInts(value: unknown): number[] {
  return String(value ?? "")
    .replace(/[[\]]/g, "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const parsed = Number(part);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    });
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "number" && Number.isNaN(value));
}

export function inferGranularity(d0: Date, d1: Date): string {
  const days = Math.floor((d1.getTime() - d0.getTime()) / MS_PER_DAY);
  if (days >= 6) return "weekly";
  if (days >= 1) return "daily";
  return "hourly";
}

/** Build an {@link InterestOverTimeResult} from a widget `default` object (`timelineData`). */
export function interestOverTimeToResult(
  def: Record<string, any>,
  keywords: string[],
  geo: string | string[],
): InterestOverTimeResult {
  const geoList = Array.isArray(geo) ? geo : [geo];
  const timeline: Array<Record<string, unknown>> = def?.timelineData ?? [];
  if (timeline.length === 0) {
    return new InterestOverTimeResult(keywords, "unknown", []);
  }

  let granularity = "unknown";
  if (timeline.length >= 2) {
    const t0 = Number(timeline[0]!.time);
    const t1 = Number(timeline[1]!.time);
    granularity = inferGranularity(new Date(t0 * 1000), new Date(t1 * 1000));
  }

  // Series order matches itertools.product(keywords, geoList) in the Python library.
  const series: string[] = [];
  for (const keyword of keywords) {
    for (const geoItem of geoList) {
      series.push(geoList.length === 1 ? keyword : `${keyword}|${geoItem}`);
    }
  }

  const points: TrendPoint[] = timeline.map((entry) => {
    const date = new Date(Number(entry.time) * 1000);
    const values = splitBracketedInts(entry.value ?? "");
    const scores: Record<string, number> = {};
    for (let i = 0; i < series.length && i < values.length; i += 1) {
      scores[series[i]!] = values[i]!;
    }
    return { date, scores };
  });

  return new InterestOverTimeResult(keywords, granularity, points);
}

/** Rows from `geoMapData` for `keyword` (its index in `kwList` selects the value column). */
export function interestByRegionRows(
  def: Record<string, any>,
  keyword: string,
  kwList: string[],
): RegionalInterestRow[] {
  const idx = kwList.includes(keyword) ? kwList.indexOf(keyword) : 0;
  const items: Array<Record<string, unknown>> = def?.geoMapData ?? [];
  return items.map((item) => {
    const values = splitBracketedInts(item.value ?? "");
    return {
      label: String(item.geoName ?? ""),
      value: idx < values.length ? values[idx]! : 0,
    };
  });
}

export function interestByRegionToResult(
  def: Record<string, any>,
  keyword: string,
  kwList: string[],
  resolution: Resolution,
): InterestByRegionResult {
  return { keyword, resolution, rows: interestByRegionRows(def, keyword, kwList) };
}

/** Map trending search titles to {@link TrendingItem} (this endpoint carries no traffic/articles). */
export function trendingTitlesToItems(titles: string[]): TrendingItem[] {
  return titles.map((title) => ({ title: String(title), traffic: "", articles: [] }));
}

export function trendingResultFromTitles(titles: string[]): TrendingResult {
  return { results: trendingTitlesToItems(titles) };
}

function toIntOrNull(value: unknown): number | null {
  if (isMissing(value)) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function parseTopRelated(rows: RankedKeyword[] | null | undefined): RelatedQuery[] {
  if (!rows) return [];
  return rows.map((row) => ({
    term: String(row.query ?? ""),
    value: toIntOrNull(row.value),
  }));
}

export function parseRisingRelated(rows: RankedKeyword[] | null | undefined): RelatedQuery[] {
  if (!rows) return [];
  return rows.map((row) => {
    const raw = row.formattedValue !== undefined ? row.formattedValue : row.value;
    return {
      term: String(row.query ?? ""),
      breakout: isMissing(raw) ? null : String(raw),
    };
  });
}

/** Pick the bucket for `keyword`, or the sole bucket if only one series exists. */
export function relatedQueriesToResult(raw: RelatedQueriesRaw, keyword: string): RelatedResult {
  const keys = Object.keys(raw ?? {});
  if (keys.length === 0) return { top: [], rising: [] };

  let part = raw[keyword];
  if (part === undefined) {
    if (keys.length !== 1) return { top: [], rising: [] };
    part = raw[keys[0]!]!;
  }

  return {
    top: parseTopRelated(part.top),
    rising: parseRisingRelated(part.rising),
  };
}
