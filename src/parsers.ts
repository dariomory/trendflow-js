import type { Resolution } from "./enums.js";
import {
  InterestOverTimeResult,
  type InterestByRegionResult,
  type RegionalInterestRow,
  type RelatedQuery,
  type RelatedResult,
  type TrendingItem,
  type TopicSuggestion,
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

/**
 * An array to iterate, whatever Google sent.
 *
 * Every parser below reads a positional structure Google owns and can change without notice.
 * Individual rows were already guarded; the containers were not, so a `null` where an array was
 * expected threw out of the parser and became an error for the caller. Junk in, empty out —
 * never a throw.
 */
function rowsOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** An object to read, whatever Google sent. See {@link rowsOf}. */
function fieldsOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Epoch seconds from a timeline entry, or null when it carries none that can be used. */
function timestampOf(entry: unknown): number | null {
  const raw = fieldsOf(entry).time;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : null;
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
  // Paired with its timestamp up front: an entry with no usable `time` cannot be placed on an
  // axis, and dropping it beats discarding the whole series over one malformed point.
  const timeline = rowsOf(fieldsOf(def).timelineData)
    .map((entry) => ({ at: timestampOf(entry), entry }))
    .filter((row): row is { at: number; entry: unknown } => row.at !== null);
  if (timeline.length === 0) {
    return new InterestOverTimeResult(keywords, "unknown", []);
  }

  let granularity = "unknown";
  if (timeline.length >= 2) {
    granularity = inferGranularity(
      new Date(timeline[0]!.at * 1000),
      new Date(timeline[1]!.at * 1000),
    );
  }

  // Series order matches itertools.product(keywords, geoList) in the Python library.
  const series: string[] = [];
  for (const keyword of keywords) {
    for (const geoItem of geoList) {
      series.push(geoList.length === 1 ? keyword : `${keyword}|${geoItem}`);
    }
  }

  const points: TrendPoint[] = timeline.map(({ at, entry }) => {
    const date = new Date(at * 1000);
    const values = splitBracketedInts(fieldsOf(entry).value ?? "");
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
  return rowsOf(fieldsOf(def).geoMapData).map((item) => {
    const cells = fieldsOf(item);
    const values = splitBracketedInts(cells.value ?? "");
    return {
      label: String(cells.geoName ?? ""),
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

function formatGrowth(growth: number | null): string {
  if (growth === null) return "";
  return `${growth >= 0 ? "+" : "-"}${Math.abs(growth).toLocaleString("en-US")}%`;
}

/** Map `[term, growthPercent, volumeIndex]` rows from the trending RPC to {@link TrendingItem}. */
export function trendingRowsToItems(rows: unknown): TrendingItem[] {
  const items: TrendingItem[] = [];
  for (const row of rowsOf(rows)) {
    if (!Array.isArray(row)) continue;
    const growth = toIntOrNull(row[1]);
    items.push({
      title: String(row[0] ?? ""),
      growth,
      volume: toIntOrNull(row[2]),
      traffic: formatGrowth(growth),
      // The RPC carries neither articles nor a start time; the RSS backend supplies those.
      articles: [],
      startedAt: null,
    });
  }
  return items;
}

/** Map `[mid, title, type, ...]` rows from the suggestions RPC to {@link TopicSuggestion}. */
export function suggestionRowsToTopics(rows: unknown): TopicSuggestion[] {
  const out: TopicSuggestion[] = [];
  for (const row of rowsOf(rows)) {
    if (!Array.isArray(row) || typeof row[0] !== "string") continue;
    const type = typeof row[2] === "string" && row[2].length > 0 ? row[2] : null;
    out.push({ mid: row[0], title: String(row[1] ?? ""), type });
  }
  return out;
}

function toIntOrNull(value: unknown): number | null {
  if (isMissing(value)) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function parseTopRelated(rows: unknown): RelatedQuery[] {
  return rowsOf(rows).map((row) => {
    const cells = fieldsOf(row);
    return { term: String(cells.query ?? ""), value: toIntOrNull(cells.value) };
  });
}

export function parseRisingRelated(rows: unknown): RelatedQuery[] {
  return rowsOf(rows).map((row) => {
    const cells = fieldsOf(row);
    const raw = cells.formattedValue !== undefined ? cells.formattedValue : cells.value;
    return {
      term: String(cells.query ?? ""),
      breakout: isMissing(raw) ? null : String(raw),
    };
  });
}

/** Pick the bucket for `keyword`, or the sole bucket if only one series exists. */
export function relatedQueriesToResult(raw: unknown, keyword: string): RelatedResult {
  const buckets = fieldsOf(raw);
  const keys = Object.keys(buckets);
  if (keys.length === 0) return { top: [], rising: [] };

  // Falling back to the sole bucket is safe; guessing between several would attribute one
  // term's data to another.
  let part = buckets[keyword];
  if (part === undefined) {
    if (keys.length !== 1) return { top: [], rising: [] };
    part = buckets[keys[0]!];
  }

  const cells = fieldsOf(part);
  return { top: parseTopRelated(cells.top), rising: parseRisingRelated(cells.rising) };
}
