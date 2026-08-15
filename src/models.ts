import type { ExportFormat, Resolution } from "./enums.js";

/** One timestamp in an interest-over-time series. */
export interface TrendPoint {
  readonly date: Date;
  readonly scores: Readonly<Record<string, number>>;
}

/** One row of {@link InterestOverTimeResult.toArray}: a date plus one column per series. */
export interface TrendRow {
  date: Date;
  [series: string]: Date | number;
}

/** One row of {@link InterestOverTimeResult.toJSON}: dates serialized as ISO 8601 strings. */
export interface TrendRecord {
  date: string;
  [series: string]: string | number;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Interest over time for one or more keywords. */
export class InterestOverTimeResult {
  readonly keywords: string[];
  readonly granularity: string;
  readonly points: TrendPoint[];

  constructor(keywords: string[], granularity: string, points: TrendPoint[]) {
    this.keywords = keywords;
    this.granularity = granularity;
    this.points = points;
  }

  /** Column names: the keywords themselves, or the `keyword|geo` series when comparing geos. */
  get columns(): string[] {
    if (this.points.length === 0) return [...this.keywords];
    const seen = new Set<string>();
    for (const point of this.points) {
      for (const key of Object.keys(point.scores)) seen.add(key);
    }
    return [...seen];
  }

  /** Plain object array with a `date` key and one key per series — the JS answer to `to_dataframe()`. */
  toArray(): TrendRow[] {
    return this.points.map((point) => ({ date: point.date, ...point.scores }));
  }

  /** Same rows as {@link toArray}, with ISO 8601 date strings. Also used by `JSON.stringify`. */
  toJSON(): TrendRecord[] {
    return this.points.map((point) => ({
      date: point.date.toISOString(),
      ...point.scores,
    }));
  }

  /** CSV text with a header row: `date` followed by one column per series. */
  toCSV(): string {
    const columns = this.columns;
    const header = ["date", ...columns].map(csvCell).join(",");
    const lines = this.points.map((point) => {
      const cells = columns.map((column) => {
        const value = point.scores[column];
        return value === undefined ? "" : String(value);
      });
      return [csvCell(point.date.toISOString()), ...cells].join(",");
    });
    return [header, ...lines].join("\n") + "\n";
  }

  /**
   * Write results to CSV or JSON (UTF-8). Node.js only — in the browser use
   * {@link toCSV} / {@link toJSON} instead.
   */
  async export(fmt: ExportFormat, path: string): Promise<void> {
    const { exportInterestOverTime } = await import("./exporters.js");
    await exportInterestOverTime(this, fmt, path);
  }
}

/** One region row from interest-by-region. */
export interface RegionalInterestRow {
  readonly label: string;
  readonly value: number;
}

/** Regional popularity for a single keyword. */
export interface InterestByRegionResult {
  readonly keyword: string;
  readonly resolution: Resolution;
  readonly rows: RegionalInterestRow[];
}

/** A news article behind a trending search. Only the RSS backend reports these. */
export interface TrendingArticle {
  readonly title: string;
  readonly url: string;
  readonly source: string;
  readonly picture: string | null;
}

/**
 * A single trending search entry.
 *
 * Both backends fill `title` and `traffic`; the rest depends on which one answered, since
 * Google exposes different fields on each. See {@link TrendingResult.source}.
 */
export interface TrendingItem {
  readonly title: string;
  /** Percentage increase over the window, e.g. `3950`. RPC backend only. */
  readonly growth: number | null;
  /** Relative search volume, on Google's own 0-100 style scale. RPC backend only. */
  readonly volume: number | null;
  /** Human-readable traffic: `"+3,950%"` from the RPC, `"2000+"` from RSS. */
  readonly traffic: string;
  /** News articles behind the trend. RSS backend only; empty from the RPC. */
  readonly articles: TrendingArticle[];
  /** When Google started reporting the trend. RSS backend only. */
  readonly startedAt: Date | null;
}

/** Which source produced a trending result. */
export type TrendingSource = "rpc" | "rss";

/** Current trending searches for a region. */
export interface TrendingResult {
  readonly results: TrendingItem[];
  /** Which backend answered — useful when `backend: "auto"` picked for you. */
  readonly source: TrendingSource;
}

/**
 * An entity Google recognises, as returned by search suggestions.
 *
 * `mid` is the identifier to pass as a keyword to query the **topic** rather than the
 * literal phrase — a topic aggregates every spelling and translation of the same concept.
 */
export interface TopicSuggestion {
  /** Freebase-style entity id, e.g. `"/m/0mkz"`. Pass this as a keyword. */
  readonly mid: string;
  /** Display name, e.g. `"Artificial intelligence"`. */
  readonly title: string;
  /** Disambiguating descriptor, e.g. `"Professional field"`. Null when Google omits it. */
  readonly type: string | null;
}

/** A top or rising related query. */
export interface RelatedQuery {
  readonly term: string;
  readonly value?: number | null;
  readonly breakout?: string | null;
}

/** Related queries for a seed keyword. */
export interface RelatedResult {
  readonly top: RelatedQuery[];
  readonly rising: RelatedQuery[];
}
