import { Router } from "express";
import { asyncHandler } from "../../core/asyncHandler";
import { ApiError } from "../../core/ApiError";
import { query } from "../../db/query";

const router = Router();

/**
 * GET /api/progress/:user_id
 *
 * Returns the user's completed-module map, shaped like Firestore's
 * `progress.done` (module_code -> ISO completion date), plus an empty
 * `scores` array for shape parity with the legacy ProgressSnapshot type.
 */
router.get(
  "/:user_id",
  asyncHandler(async (req, res) => {
    const rows = await query<{ module_code: string; completed_at: Date }>(
      `SELECT module_code, completed_at FROM user_topic_progress WHERE user_id = $1`,
      [req.params.user_id]
    );

    const done: Record<string, string> = {};
    for (const row of rows) {
      done[row.module_code] = row.completed_at.toISOString();
    }

    res.json({ scores: [], done });
  })
);

/**
 * PUT /api/progress/:user_id/:module_code
 *
 * Marks one module done (or updates its completion timestamp).
 */
router.put(
  "/:user_id/:module_code",
  asyncHandler(async (req, res) => {
    const { user_id, module_code } = req.params;
    const completedAt =
      typeof req.body?.completedAt === "string" ? req.body.completedAt : new Date().toISOString();

    await query(
      `INSERT INTO user_topic_progress (user_id, module_code, completed_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, module_code) DO UPDATE SET completed_at = EXCLUDED.completed_at`,
      [user_id, module_code, completedAt]
    );

    res.json({ ok: true, user_id, module_code, completedAt });
  })
);

/**
 * DELETE /api/progress/:user_id/:module_code
 *
 * Unmarks a module (removes the row entirely, matching the Firestore
 * FieldValue.delete() semantics the old route relied on).
 */
router.delete(
  "/:user_id/:module_code",
  asyncHandler(async (req, res) => {
    const { user_id, module_code } = req.params;
    const rows = await query(
      `DELETE FROM user_topic_progress WHERE user_id = $1 AND module_code = $2 RETURNING module_code`,
      [user_id, module_code]
    );
    if (rows.length === 0) {
      throw ApiError.notFound(`No progress found for module ${module_code}`);
    }
    res.json({ ok: true });
  })
);

export default router;
