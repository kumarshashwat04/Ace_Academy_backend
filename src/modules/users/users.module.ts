import { Router } from "express";
import { BaseRepository } from "../../core/BaseRepository";
import { asyncHandler } from "../../core/asyncHandler";
import { ApiError } from "../../core/ApiError";
import { query } from "../../db/query";
import { withTransaction } from "../../db/transaction";
import {
  CertificationLevelRow,
  buildInitialCertificationRows,
  getCurrentLevelFromModules,
  groupCertificationLevels,
} from "../certifications/certifications.logic";

export const usersRepository = new BaseRepository("users");

type UserRow = {
  id: string;
  name: string;
  email: string;
  team: string;
  role: "admin" | "learner";
  allowed_level: number;
  allowed_level_source: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  updated_by: string | null;
};

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    if (req.query.expand === "full") {
      return res.json({ users: await findAllUsersExpanded() });
    }

    const result = await usersRepository.findAll(req.query as Record<string, unknown>);
    return res.json(result);
  })
);

/**
 * Bulk listing with each user's certifications + modulesCovered attached,
 * batched (not N+1) — used by both the admin User Management listing and
 * the Rankings page, which each just project down to the fields they need.
 */
async function findAllUsersExpanded() {
  const users = await query<UserRow>(`SELECT * FROM users ORDER BY name`);
  const ids = users.map((u) => u.id);

  if (ids.length === 0) return [];

  const [certRows, progressCounts] = await Promise.all([
    query<CertificationLevelRow & { user_id: string }>(
      `SELECT user_id, module_name, level_name, status, score, attempted_time_seconds, no_of_attempts, last_attempt_date, completed_at
         FROM certification_levels WHERE user_id = ANY($1)`,
      [ids]
    ),
    query<{ user_id: string; count: string }>(
      `SELECT user_id, COUNT(*)::text AS count FROM user_topic_progress WHERE user_id = ANY($1) GROUP BY user_id`,
      [ids]
    ),
  ]);

  const certsByUser = new Map<string, CertificationLevelRow[]>();
  for (const row of certRows) {
    const list = certsByUser.get(row.user_id) ?? [];
    list.push(row);
    certsByUser.set(row.user_id, list);
  }

  const modulesCoveredByUser = new Map<string, number>();
  for (const row of progressCounts) modulesCoveredByUser.set(row.user_id, Number(row.count));

  return users.map((u) => ({
    uid: u.id,
    name: u.name,
    email: u.email,
    team: u.team,
    role: u.role,
    av: "",
    certifications: groupCertificationLevels(certsByUser.get(u.id) ?? []),
    modulesCovered: modulesCoveredByUser.get(u.id) ?? 0,
  }));
}

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const row = await usersRepository.findById(req.params.id);
    if (!row) throw ApiError.notFound(`User ${req.params.id} not found`);
    res.json({ data: row });
  })
);

/**
 * GET /api/users/:id/profile
 *
 * Combined profile: base user row + certifications (joined from
 * certification_levels) + progress.done (joined from user_topic_progress) +
 * a freshly-computed `level`, matching the shape of Firestore's
 * users/{uid} document (FirestoreUserProfile) so it can be a drop-in
 * primary source for the frontend's login-hydration and profile reads.
 */
router.get(
  "/:id/profile",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const user = await usersRepository.findById(id);
    if (!user) throw ApiError.notFound(`User ${id} not found`);

    const [certRows, progressRows] = await Promise.all([
      query<CertificationLevelRow>(
        `SELECT module_name, level_name, status, score, attempted_time_seconds, no_of_attempts, last_attempt_date, completed_at
           FROM certification_levels WHERE user_id = $1`,
        [id]
      ),
      query<{ module_code: string; completed_at: Date }>(
        `SELECT module_code, completed_at FROM user_topic_progress WHERE user_id = $1`,
        [id]
      ),
    ]);

    const certifications = groupCertificationLevels(certRows);
    const done: Record<string, string> = {};
    for (const row of progressRows) done[row.module_code] = row.completed_at.toISOString();

    const row = user as UserRow;
    res.json({
      uid: id,
      name: row.name,
      email: row.email,
      team: row.team,
      role: row.role,
      level: getCurrentLevelFromModules(certifications),
      allowedLevel: row.allowed_level,
      allowedLevelSource: row.allowed_level_source,
      certifications,
      progress: { done, scores: [] },
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    });
  })
);

type CreateUserBody = {
  id?: string;
  name?: string;
  email?: string;
  team?: string;
  role?: "admin" | "learner";
  allowedLevel?: number;
  allowedLevelSource?: string;
};

/**
 * POST /api/users
 *
 * Creates the Postgres profile row for a user, plus a full set of default
 * certification_levels rows (mirrors createInitialCertifications on the
 * frontend). Creating the actual Firebase Auth login is still the caller's
 * (Next.js server's) job — this endpoint only owns the Postgres side.
 */
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as CreateUserBody;
    const { id, name, email, team, role } = body;

    if (!id || !name || !email || !team || (role !== "admin" && role !== "learner")) {
      throw ApiError.badRequest("id, name, email, team, and role ('admin'|'learner') are required.");
    }

    const user = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO users (id, name, email, team, role, allowed_level, allowed_level_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [id, name, email, team, role, body.allowedLevel ?? 0, body.allowedLevelSource ?? "team"]
      );

      const rows = buildInitialCertificationRows(id);
      for (const row of rows) {
        await client.query(
          `INSERT INTO certification_levels
             (user_id, module_name, level_name, status, score, attempted_time_seconds, no_of_attempts, last_attempt_date, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            row.user_id,
            row.module_name,
            row.level_name,
            row.status,
            row.score,
            row.attempted_time_seconds,
            row.no_of_attempts,
            row.last_attempt_date,
            row.completed_at,
          ]
        );
      }

      return inserted.rows[0];
    });

    res.status(201).json({ data: user });
  })
);

type PatchUserBody = {
  name?: string;
  role?: "admin" | "learner";
  team?: string;
  allowedLevel?: number;
  allowedLevelSource?: string;
  updatedBy?: string;
};

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = (req.body ?? {}) as PatchUserBody;

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (body.role === "admin" || body.role === "learner") updates.role = body.role;
    if (typeof body.team === "string" && body.team.trim()) updates.team = body.team.trim();
    if (typeof body.allowedLevel === "number") {
      updates.allowed_level = body.allowedLevel;
      updates.allowed_level_source = body.allowedLevelSource ?? "individual";
    }
    if (typeof body.updatedBy === "string") updates.updated_by = body.updatedBy;

    if (Object.keys(updates).length === 1) {
      throw ApiError.badRequest("No valid fields to update (name, role, team, or allowedLevel).");
    }

    const row = await usersRepository.update(id, updates);
    if (!row) throw ApiError.notFound(`User ${id} not found`);
    res.json({ data: row });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const deleted = await usersRepository.remove(req.params.id);
    if (!deleted) throw ApiError.notFound(`User ${req.params.id} not found`);
    res.json({ ok: true, id: req.params.id });
  })
);

export default router;
