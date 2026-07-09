import { RequestHandler } from "express";
import { config } from "../config";
import { ApiError } from "../core/ApiError";

/**
 * Gates every /api route behind a shared secret. The only intended caller is
 * the Next.js server (server-side proxy calls, never the browser), so a
 * static shared key is proportionate — this backend never talks to Firebase
 * itself, keeping auth concerns entirely out of it.
 */
export const requireInternalKey: RequestHandler = (req, _res, next) => {
  const key = req.header("x-internal-key");
  if (key !== config.internalApiKey) {
    throw ApiError.unauthorized();
  }
  next();
};
