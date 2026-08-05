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

/** Time ranges accepted by Google Trends. */
export const Timeframe = {
  PAST_DAY: "now 1-d",
  PAST_WEEK: "now 7-d",
  PAST_YEAR: "today 12-m",
  PAST_5_YEARS: "today 5-y",
} as const;
export type Timeframe = (typeof Timeframe)[keyof typeof Timeframe];

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
