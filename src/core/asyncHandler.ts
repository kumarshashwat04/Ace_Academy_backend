import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps an async route handler so any rejected promise is forwarded to
 * Express's error middleware instead of becoming an unhandled rejection.
 *
 *   router.get("/", asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
