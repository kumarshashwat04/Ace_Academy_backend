/**
 * An error that carries an HTTP status code. The central error handler turns
 * these into clean JSON responses; anything else becomes a generic 500.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = "Bad request", details?: unknown): ApiError {
    return new ApiError(400, message, details);
  }

  static notFound(message = "Resource not found"): ApiError {
    return new ApiError(404, message);
  }

  static internal(message = "Internal server error"): ApiError {
    return new ApiError(500, message);
  }
}
