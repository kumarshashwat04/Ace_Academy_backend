import { RequestHandler } from "express";

/**
 * Catches requests that matched no route and returns a JSON 404.
 */
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
};
