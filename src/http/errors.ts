/** The Trends endpoint returned a non-JSON or error response. */
export class ResponseError extends Error {
  readonly status: number;
  readonly response: Response;

  constructor(message: string, response: Response) {
    super(message);
    this.name = "ResponseError";
    this.status = response.status;
    this.response = response;
  }

  static fromResponse(response: Response): ResponseError {
    return new ResponseError(
      `The request failed: Google returned a response with code ${response.status}`,
      response,
    );
  }
}

/** Where the rate-limit guidance lives. Deliberately a plain docs link, not a referral one. */
export const RATE_LIMIT_DOCS_URL = "https://github.com/dariomory/trendflow-js#rate-limits";

/** HTTP 429 from Google Trends. */
export class TooManyRequestsError extends ResponseError {
  constructor(message: string, response: Response) {
    super(message, response);
    this.name = "TooManyRequestsError";
  }

  static override fromResponse(response: Response): TooManyRequestsError {
    return new TooManyRequestsError(
      `The request failed: Google returned a response with code ${response.status}. ` +
        `Google rate-limits by exit IP; see ${RATE_LIMIT_DOCS_URL} for how to work around it.`,
      response,
    );
  }
}
