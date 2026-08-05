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

/** A single trending search entry. */
export interface TrendingItem {
  readonly title: string;
  /** Percentage increase in searches over the window, e.g. `3950` for a 3,950% rise. */
  readonly growth: number | null;
  /** Relative search volume for the term, on Google's own 0-100 style scale. */
  readonly volume: number | null;
  /** Human-readable form of {@link growth}, e.g. `"+3,950%"`. */
  readonly traffic: string;
  /** Always empty: the endpoint backing this data carries no article links. */
  readonly articles: string[];
}

/** Current trending searches for a region. */
export interface TrendingResult {
  readonly results: TrendingItem[];
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
