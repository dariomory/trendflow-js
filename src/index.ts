export { GoogleTrendsFetcher, GoogleTrendsFetcher as Client, TrendingWindow } from "./fetcher.js";
export type { ClientOptions, TrendsFetcher } from "./fetcher.js";

export { ExportFormat, Region, Resolution, Timeframe } from "./enums.js";

export { InterestOverTimeResult } from "./models.js";
export type {
  InterestByRegionResult,
  RegionalInterestRow,
  RelatedQuery,
  RelatedResult,
  TopicSuggestion,
  TrendingItem,
  TrendingResult,
  TrendPoint,
  TrendRecord,
  TrendRow,
} from "./models.js";

export { ResponseError, TooManyRequestsError } from "./http/errors.js";
export { ProxyPool } from "./http/proxy.js";
export {
  RPC_GEO_LIST,
  RPC_SUGGESTIONS,
  RPC_TRENDING,
  UnknownRpcError,
} from "./http/batchexecute.js";
export type { RpcIds } from "./http/batchexecute.js";
