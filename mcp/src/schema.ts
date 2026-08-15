/**
 * Zod schemas for the tool inputs.
 *
 * The library's enums are `as const` objects, so they convert straight into zod enums and
 * from there into JSON Schema `enum` constraints. That matters more than it looks: a model
 * left to guess between `"US"` and `"United States"` produces a silently wrong answer
 * rather than a validation error.
 */
import { Region, Resolution, Timeframe } from "trendflow";
import { z } from "zod";

function values<T extends Record<string, string>>(obj: T): [string, ...string[]] {
  const list = Object.values(obj);
  return [list[0]!, ...list.slice(1)];
}

/**
 * Region codes the library names. The feed and RPC accept any ISO country code, so this is
 * a `union` with a free-form string rather than a closed enum — the enum still shows the
 * model the common values without rejecting a valid code the library never listed.
 */
export const regionSchema = z
  .union([z.enum(values(Region)), z.string().regex(/^[A-Z]{2}$/, "two-letter country code")])
  .describe('Country code such as "US", "GB", "TH". Empty string means worldwide.');

export const timeframeSchema = z
  .enum(values(Timeframe))
  .describe("Time range for the series.");

export const resolutionSchema = z
  .enum(values(Resolution))
  .describe("Geographic granularity of the breakdown.");

/**
 * Google's explore endpoint compares at most five items, so this cap matches the API rather
 * than being an arbitrary guard — and it stops an agent asking for 200 terms at once.
 */
export const keywordsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(5)
  .describe(
    "1-5 search terms. Pass several to compare them against each other. " +
      'Accepts topic ids from search_topics (e.g. "/m/0mkz") as well as literal phrases.',
  );

export const keywordSchema = z
  .string()
  .min(1)
  .describe('A search term, or a topic id from search_topics (e.g. "/m/0mkz").');

export const trendingBackendSchema = z
  .enum(["auto", "rpc", "rss"])
  .describe(
    'Source to use. "rpc" returns ~50 items with growth percentages; "rss" returns 10 ' +
      'with the news articles behind each trend; "auto" tries rpc then falls back to rss.',
  );

export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(50)
  .describe("Maximum number of results to return.");
