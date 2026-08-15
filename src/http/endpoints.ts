export const BASE_TRENDS_URL = "https://trends.google.com/trends";

export const EXPLORE = `${BASE_TRENDS_URL}/api/explore`;
export const INTEREST_OVER_TIME = `${BASE_TRENDS_URL}/api/widgetdata/multiline`;
export const MULTIRANGE_INTEREST_OVER_TIME = `${BASE_TRENDS_URL}/api/widgetdata/multirange`;
export const INTEREST_BY_REGION = `${BASE_TRENDS_URL}/api/widgetdata/comparedgeo`;
export const RELATED_QUERIES = `${BASE_TRENDS_URL}/api/widgetdata/relatedsearches`;
export const TRENDING_SEARCHES = `${BASE_TRENDS_URL}/hottrends/visualize/internal/data`;
export const TOP_CHARTS = `${BASE_TRENDS_URL}/api/topcharts`;
export const AUTOCOMPLETE_PREFIX = `${BASE_TRENDS_URL}/api/autocomplete/`;
export const GEO_PICKER = `${BASE_TRENDS_URL}/api/explore/pickers/geo`;
export const CATEGORY_PICKER = `${BASE_TRENDS_URL}/api/explore/pickers/category`;
export const TODAY_SEARCHES = `${BASE_TRENDS_URL}/api/dailytrends`;
export const REALTIME_TRENDING = `${BASE_TRENDS_URL}/api/realtimetrends`;

/**
 * The RPC endpoint behind the current Trends UI. TRENDING_SEARCHES, TODAY_SEARCHES, and
 * REALTIME_TRENDING above are all retired by Google and now return 404; this replaces them.
 */
export const BATCH_EXECUTE = "https://trends.google.com/_/TrendsUi/data/batchexecute";

/** Trending Now as an RSS feed. Independent of the RPC, and the only source with articles. */
export const TRENDING_RSS = "https://trends.google.com/trending/rss";

export const HTTP_TOO_MANY_REQUESTS = 429;
