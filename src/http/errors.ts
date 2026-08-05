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

/** HTTP 429 from Google Trends. */
export class TooManyRequestsError extends ResponseError {
  constructor(message: string, response: Response) {
    super(message, response);
    this.name = "TooManyRequestsError";
  }

  static override fromResponse(response: Response): TooManyRequestsError {
    return new TooManyRequestsError(
      `The request failed: Google returned a response with code ${response.status}`,
      response,
    );
  }
}
