import { Router } from "express";
import { asyncHandler } from "../../core/asyncHandler";
import { ApiError } from "../../core/ApiError";
import { query } from "../../db/query";
import {
  CertificationLevelRow,
  groupCertificationLevels,
} from "./certifications.logic";

const router = Router();

const ALLOWED_STATUSES = ["not_started", "not_attempted", "in_progress", "completed", "locked"];

/**
 * GET /api/certifications?user_id=<uid>
 *
 * Returns that user's certification progress grouped into the same
 * CertificationModule[] shape the frontend already works with.
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.query.user_id;
    if (typeof userId !== "string" || !userId) {
      throw ApiError.badRequest("user_id query parameter is required.");
    }

    const rows = await query<CertificationLevelRow>(
      `SELECT module_name, level_name, status, score, attempted_time_seconds, no_of_attempts, last_attempt_date, completed_at
         FROM certification_levels
        WHERE user_id = $1`,
      [userId]
    );

    res.json({ data: groupCertificationLevels(rows) });
  })
);

/**
 * PUT /api/certifications/:user_id/:module_name/:level_name
 *
 * Upserts one level's progress fields. Only the fields present in the body
 * are changed on an existing row; a missing row is created with defaults
 * for anything not supplied.
 */
router.put(
  "/:user_id/:module_name/:level_name",
  asyncHandler(async (req, res) => {
    const { user_id, module_name, level_name } = req.params;
    const body = req.body ?? {};

    const fieldMap: Record<string, unknown> = {};
    if (typeof body.status === "string") {
      if (!ALLOWED_STATUSES.includes(body.status)) {
        throw ApiError.badRequest(`Invalid status: ${body.status}`);
      }
      fieldMap.status = body.status;
    }
    if (typeof body.score === "number") fieldMap.score = body.score;
    if (typeof body.attemptedTime === "number") fieldMap.attempted_time_seconds = body.attemptedTime;
    if (typeof body.noOfAttempts === "number") fieldMap.no_of_attempts = body.noOfAttempts;
    if (body.lastAttemptDate !== undefined) fieldMap.last_attempt_date = body.lastAttemptDate;
    if (body.completedAt !== undefined) fieldMap.completed_at = body.completedAt;

    if (Object.keys(fieldMap).length === 0) {
      throw ApiError.badRequest("No valid fields to update.");
    }

    const setColumns = Object.keys(fieldMap);
    const setClause = setColumns.map((col, i) => `"${col}" = $${i + 4}`).join(", ");
    const updateParams = [user_id, module_name, level_name, ...setColumns.map((c) => fieldMap[c])];

    const updated = await query(
      `UPDATE certification_levels
          SET ${setClause}
        WHERE user_id = $1 AND module_name = $2 AND level_name = $3
      RETURNING *`,
      updateParams
    );

    if (updated.length > 0) {
      return res.json({ data: updated[0] });
    }

    const inserted = await query(
      `INSERT INTO certification_levels
         (user_id, module_name, level_name, status, score, attempted_time_seconds, no_of_attempts, last_attempt_date, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        user_id,
        module_name,
        level_name,
        fieldMap.status ?? "locked",
        fieldMap.score ?? 0,
        fieldMap.attempted_time_seconds ?? 0,
        fieldMap.no_of_attempts ?? 0,
        fieldMap.last_attempt_date ?? null,
        fieldMap.completed_at ?? null,
      ]
    );

    return res.status(201).json({ data: inserted[0] });
  })
);

export default router;
