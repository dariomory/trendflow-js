/**
 * Tool and resource registration.
 *
 * Descriptions are written for a model deciding whether to call, not for a human reading a
 * reference: each says *when* the tool applies. They also carry the one caveat models get
 * wrong unprompted — Google Trends values are normalized relative interest, never absolute
 * search volume.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "trendflow";
import { Region, Resolution, Timeframe } from "trendflow";

import {
  keywordSchema,
  keywordsSchema,
  limitSchema,
  regionSchema,
  resolutionSchema,
  timeframeSchema,
  trendingBackendSchema,
} from "./schema.js";
import { fail, ok } from "./serialize.js";

const RELATIVE_NOTE =
  "Values are Google's normalized relative interest (0-100 within the result set), " +
  "not absolute search volume.";

export function registerTools(server: McpServer, client: Client): void {
  server.registerTool(
    "search_topics",
    {
      title: "Search topics",
      description:
        "Look up the Google Trends topic id for a thing. Call this FIRST whenever the " +
        "user names an entity — a company, product, person, technology, concept — then " +
        "pass the returned `mid` as a keyword to the other tools.\n\n" +
        "A topic aggregates every spelling and translation of the same concept, so it " +
        "measures far more search activity than the literal phrase: querying the topic " +
        'for "artificial intelligence" scores 62 where the literal string scores 1. ' +
        "The `type` field disambiguates same-name entities (Nike the company vs the " +
        "goddess). Skip this only when the user explicitly wants a literal phrase.\n\n" +
        "Cheapest tool here: it needs no cookie and works on IPs that rate-limit the others.",
      inputSchema: { query: keywordSchema },
    },
    async ({ query }) => {
      try {
        return ok({ topics: await client.suggestions(query) });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_interest_over_time",
    {
      title: "Interest over time",
      description:
        "Get relative search interest for one or more terms over a historical period. " +
        "Use this when the user asks how popular something is, whether it is rising or " +
        "falling, or how several things compare — passing multiple keywords compares " +
        `them against each other on one scale. ${RELATIVE_NOTE}`,
      inputSchema: {
        keywords: keywordsSchema,
        timeframe: timeframeSchema.optional(),
        region: regionSchema.optional(),
      },
    },
    async ({ keywords, timeframe, region }) => {
      try {
        const result = await client.interestOverTime(
          keywords,
          (timeframe as Timeframe) ?? Timeframe.PAST_YEAR,
          (region as Region) ?? Region.US,
        );
        return ok({
          keywords: result.keywords,
          granularity: result.granularity,
          points: result.points,
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_interest_by_region",
    {
      title: "Interest by region",
      description:
        "Break down search interest for one term by geography. Use this when the user " +
        "asks where something is popular, or wants a regional or city-level comparison. " +
        `${RELATIVE_NOTE}`,
      inputSchema: {
        keyword: keywordSchema,
        resolution: resolutionSchema.optional(),
        region: regionSchema.optional(),
      },
    },
    async ({ keyword, resolution, region }) => {
      try {
        const result = await client.interestByRegion(
          keyword,
          (resolution as Resolution) ?? Resolution.COUNTRY,
          (region as Region) ?? Region.US,
        );
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_related_queries",
    {
      title: "Related queries",
      description:
        "Find the top and rising searches related to a term. Use this for keyword " +
        "discovery, SEO and content research, finding what people search alongside a " +
        "topic, and spotting breakout queries. `top` is ranked by volume; `rising` is " +
        'ranked by growth, where a "Breakout" value means growth too large to measure.',
      inputSchema: { keyword: keywordSchema },
    },
    async ({ keyword }) => {
      try {
        return ok(await client.relatedQueries(keyword));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_trending_now",
    {
      title: "Trending now",
      description:
        "List searches surging right now in a country. Use this for discovery — what is " +
        "spiking without the user naming a term — and for news, monitoring, and " +
        'real-time questions. Choose backend "rss" when the user wants to know *why* ' +
        "something is trending: it returns the news articles behind each entry, which " +
        "the default source does not carry.",
      inputSchema: {
        region: regionSchema.optional(),
        backend: trendingBackendSchema.optional(),
        limit: limitSchema.optional(),
      },
    },
    async ({ region, backend, limit }) => {
      try {
        const result = await client.trendingNow((region as Region) ?? Region.WORLDWIDE, {
          backend: backend ?? "auto",
        });
        return ok({
          source: result.source,
          results: result.results.slice(0, limit ?? 20),
          truncated: result.results.length > (limit ?? 20),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "research_trend",
    {
      title: "Research a trend",
      description:
        "Full picture of one term in a single call: interest over time, where it is " +
        "popular, and what people search alongside it. Use this when the user asks to " +
        '"research", "analyse", or "look into" a topic rather than asking one narrow ' +
        "question — it saves three round trips.\n\n" +
        "Each section is fetched independently, so a partial result is normal: any " +
        "section that fails carries an `error` instead of data, and the rest still " +
        "returns. Pass a topic id from search_topics for materially better numbers.",
      inputSchema: { keyword: keywordSchema, region: regionSchema.optional() },
    },
    async ({ keyword, region }) => {
      const geo = (region as Region) ?? Region.US;

      // Sequential, not parallel: the queries share one exit IP and one cookie jar, and
      // firing them together is exactly the pattern Google answers with a 429.
      const section = async <T>(run: () => Promise<T>) => {
        try {
          return { data: await run() };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      };

      const interestOverTime = await section(async () => {
        const r = await client.interestOverTime([keyword], Timeframe.PAST_YEAR, geo);
        return { granularity: r.granularity, points: r.points };
      });
      const byRegion = await section(() =>
        client.interestByRegion(keyword, Resolution.COUNTRY, geo),
      );
      const related = await section(() => client.relatedQueries(keyword));

      const sections = { interestOverTime, byRegion, related };
      const failed = Object.entries(sections)
        .filter(([, value]) => "error" in value)
        .map(([name]) => name);

      return ok({
        keyword,
        region: geo,
        ...sections,
        ...(failed.length > 0 ? { partial: true, failedSections: failed } : {}),
      });
    },
  );
}

export function registerResources(server: McpServer, client: Client): void {
  server.registerResource(
    "regions",
    "trendflow://regions",
    {
      title: "Supported regions",
      description:
        "Every geography Google Trends accepts: each country with its subregions. Read " +
        "this to validate or discover a region code before querying.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(await client.geoList()),
            },
          ],
        };
      } catch (error) {
        // Fall back to the codes the library names, so the resource is never empty.
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
                fallback: Object.entries(Region).map(([name, code]) => ({ name, code })),
              }),
            },
          ],
        };
      }
    },
  );

  server.registerResource(
    "capabilities",
    "trendflow://capabilities",
    {
      title: "Capabilities and known limits",
      description:
        "What this server can and cannot answer, and the caveats that affect how results " +
        "should be read.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              tools: [
                "search_topics",
                "get_interest_over_time",
                "get_interest_by_region",
                "get_related_queries",
                "get_trending_now",
                "research_trend",
              ],
              timeframes: Object.values(Timeframe),
              resolutions: Object.values(Resolution),
              trendingBackends: {
                rpc: "~50 items, growth percentage and volume index, no articles",
                rss: "10 items, news articles per entry, coarse traffic buckets only",
                auto: "rpc first, falling back to rss",
              },
              caveats: [
                "Values are normalized relative interest (0-100), not absolute search volume.",
                "Numbers are only comparable within a single result set.",
                "Topic ids from search_topics measure far more activity than literal phrases.",
                "Google rate-limits by exit IP; HTTP 429 is common and not a bug in the query.",
                "Trending articles are available only from the rss backend.",
              ],
            },
            null,
            2,
          ),
        },
      ],
    }),
  );
}
