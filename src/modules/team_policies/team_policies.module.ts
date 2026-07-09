import { Router } from "express";
import { BaseRepository } from "../../core/BaseRepository";
import { asyncHandler } from "../../core/asyncHandler";
import { ApiError } from "../../core/ApiError";

export const teamPoliciesRepository = new BaseRepository("team_policies", { primaryKey: "team" });

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await teamPoliciesRepository.findAll(req.query as Record<string, unknown>);
    res.json(result);
  })
);

router.get(
  "/:team",
  asyncHandler(async (req, res) => {
    const row = await teamPoliciesRepository.findById(req.params.team);
    if (!row) throw ApiError.notFound(`Team policy for '${req.params.team}' not found`);
    res.json({ data: row });
  })
);

/**
 * PUT /api/team_policies/:team
 *
 * Upserts a team's allowed certification level.
 */
router.put(
  "/:team",
  asyncHandler(async (req, res) => {
    const { team } = req.params;
    const allowedLevel = req.body?.allowedLevel;

    if (typeof allowedLevel !== "number") {
      throw ApiError.badRequest("allowedLevel (number) is required.");
    }

    const row = await teamPoliciesRepository.upsert({
      team,
      allowed_level: allowedLevel,
      updated_at: new Date(),
    });

    res.json({ data: row });
  })
);

export default router;
