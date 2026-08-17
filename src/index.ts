export { GoogleTrendsFetcher, GoogleTrendsFetcher as Client, TrendingWindow } from "./fetcher.js";
export type {
  ClientOptions,
  QueryFilters,
  RegionInput,
  TimeframeInput,
  TrendsFetcher,
} from "./fetcher.js";

export { ExportFormat, Region, Resolution, SearchProperty, Timeframe } from "./enums.js";

export { InterestOverTimeResult } from "./models.js";
export type {
  InterestByRegionResult,
  RegionalInterestRow,
  RelatedQuery,
  RelatedResult,
  TopicSuggestion,
  TrendingArticle,
  TrendingItem,
  TrendingResult,
  TrendingSource,
  TrendPoint,
  TrendRecord,
  TrendRow,
} from "./models.js";

export { ResponseError, TooManyRequestsError } from "./http/errors.js";
export { ProxyPool } from "./http/proxy.js";
export type { TrendingBackend, TrendingProvider } from "./http/providers.js";
export {
  RPC_GEO_LIST,
  RPC_SUGGESTIONS,
  RPC_TRENDING,
  UnknownRpcError,
} from "./http/batchexecute.js";
export type { RpcIds } from "./http/batchexecute.js";
