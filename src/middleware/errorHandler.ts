import { ErrorRequestHandler } from "express";
import { ApiError } from "../core/ApiError";
import { isProduction } from "../config";

/**
 * Central error handler. Known ApiErrors become their declared status; anything
 * else is logged and returned as a generic 500 (no internals leaked).
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  console.error("[error] Unhandled:", err);
  res.status(500).json({
    error: "Internal server error",
    ...(isProduction ? {} : { message: (err as Error)?.message }),
  });
};
