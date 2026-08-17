/** ISO-style geo codes for Google Trends (`hl` / `geo`). Empty string is worldwide. */
export const Region = {
  WORLDWIDE: "",
  US: "US",
  GB: "GB",
  DE: "DE",
  FR: "FR",
  IT: "IT",
  ES: "ES",
  CA: "CA",
  AU: "AU",
  JP: "JP",
  IN: "IN",
  BR: "BR",
  MX: "MX",
  NL: "NL",
  SE: "SE",
  PL: "PL",
  TR: "TR",
} as const;
export type Region = (typeof Region)[keyof typeof Region];

/**
 * Time ranges accepted by Google Trends.
 *
 * Named values for the presets. A custom range is a plain string of two ISO dates,
 * `"2023-01-01 2023-06-30"`, and every query method accepts one in place of a member.
 *
 * The range also decides the granularity Google returns: the hourly ranges come back in
 * minutes, the daily ones hourly, and `ALL_TIME` monthly. Ask for five years and you cannot
 * see a spike that lasted an afternoon.
 */
export const Timeframe = {
  PAST_HOUR: "now 1-H",
  PAST_4_HOURS: "now 4-H",
  PAST_DAY: "now 1-d",
  PAST_WEEK: "now 7-d",
  PAST_MONTH: "today 1-m",
  PAST_3_MONTHS: "today 3-m",
  PAST_YEAR: "today 12-m",
  PAST_5_YEARS: "today 5-y",
  ALL_TIME: "all",
} as const;
export type Timeframe = (typeof Timeframe)[keyof typeof Timeframe];

/**
 * Which Google surface to measure.
 *
 * These are separate indexes, not filters over one dataset, so the same term can look very
 * different across them — a term may be quiet on web search and busy on YouTube. Values are
 * only comparable within a single property.
 */
export const SearchProperty = {
  WEB: "",
  IMAGES: "images",
  NEWS: "news",
  YOUTUBE: "youtube",
  SHOPPING: "froogle",
} as const;
export type SearchProperty = (typeof SearchProperty)[keyof typeof SearchProperty];

/** Granularity for regional interest breakdowns. */
export const Resolution = {
  COUNTRY: "COUNTRY",
  REGION: "REGION",
  CITY: "CITY",
} as const;
export type Resolution = (typeof Resolution)[keyof typeof Resolution];

/** Supported export targets for tabular trend data. */
export const ExportFormat = {
  CSV: "csv",
  JSON: "json",
} as const;
export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];
