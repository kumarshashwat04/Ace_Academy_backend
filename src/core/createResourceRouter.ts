import { Router } from "express";
import { BaseRepository } from "./BaseRepository";
import { asyncHandler } from "./asyncHandler";
import { ApiError } from "./ApiError";

/**
 * Builds the standard read endpoints for a table-backed repository:
 *
 *   GET /          list with ?limit=&offset=&sort=&order=&<column>=<value>
 *   GET /:id       single row by primary key (404 if missing)
 *
 * A module that needs custom behavior can add routes to the returned router,
 * or stop using this factory and define handlers explicitly.
 */
export function createResourceRouter(
  repository: BaseRepository,
  resourceName: string
): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const result = await repository.findAll(req.query as Record<string, unknown>);
      res.json(result);
    })
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const row = await repository.findById(req.params.id);
      if (!row) {
        throw ApiError.notFound(`${resourceName} ${req.params.id} not found`);
      }
      res.json({ data: row });
    })
  );

  return router;
}
