/**
 * One-time (re-runnable) data migration: Firestore -> PostgreSQL.
 *
 * Run with: npm run migrate-from-firestore
 *
 * Requires FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 * (the same service-account credentials the ACE-Academy frontend already
 * uses) in this repo's .env, plus the usual DB_* vars. Every write is an
 * upsert, so it's safe to re-run while Firestore is still the live fallback
 * for anything not yet cut over to backend-primary.
 *
 * Explicitly out of scope: the `syllabi` collection (see migration plan).
 */
import { randomUUID } from "crypto";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { closePool, pool } from "../db/pool";
import { withTransaction } from "../db/transaction";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getDb() {
  const app = initializeApp({
    credential: cert({
      projectId: requireEnv("FIREBASE_PROJECT_ID"),
      clientEmail: requireEnv("FIREBASE_CLIENT_EMAIL"),
      privateKey: requireEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    }),
  });
  return getFirestore(app);
}

type LevelDoc = {
  level_name?: string;
  status?: string;
  score?: number;
  attemptedTime?: number;
  noOfAttempts?: number;
  lastAttemptDate?: string | null;
  completedAt?: string | null;
};

type CertModuleDoc = {
  module_name?: string;
  levels?: LevelDoc[];
};

async function migrateUsers(db: FirebaseFirestore.Firestore): Promise<number> {
  const snapshot = await db.collection("users").get();
  let count = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const uid = doc.id;
    const name = typeof data.name === "string" ? data.name : "";
    const email = typeof data.email === "string" ? data.email : "";
    const team = typeof data.team === "string" ? data.team : "";
    const role = data.role === "admin" ? "admin" : "learner";

    if (!name || !email || !team) {
      console.warn(`[migrate-from-firestore] Skipping user ${uid}: missing name/email/team.`);
      continue;
    }

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO users (id, name, email, team, role, allowed_level, allowed_level_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, email = EXCLUDED.email, team = EXCLUDED.team,
           role = EXCLUDED.role, allowed_level = EXCLUDED.allowed_level,
           allowed_level_source = EXCLUDED.allowed_level_source, updated_at = now()`,
        [
          uid,
          name,
          email,
          team,
          role,
          typeof data.allowedLevel === "number" ? data.allowedLevel : 0,
          typeof data.allowedLevelSource === "string" ? data.allowedLevelSource : "team",
        ]
      );

      const certifications: CertModuleDoc[] = Array.isArray(data.certifications) ? data.certifications : [];
      for (const mod of certifications) {
        if (!mod.module_name || !Array.isArray(mod.levels)) continue;
        for (const level of mod.levels) {
          if (!level.level_name) continue;
          await client.query(
            `INSERT INTO certification_levels
               (user_id, module_name, level_name, status, score, attempted_time_seconds, no_of_attempts, last_attempt_date, completed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (user_id, module_name, level_name) DO UPDATE SET
               status = EXCLUDED.status, score = EXCLUDED.score,
               attempted_time_seconds = EXCLUDED.attempted_time_seconds,
               no_of_attempts = EXCLUDED.no_of_attempts,
               last_attempt_date = EXCLUDED.last_attempt_date, completed_at = EXCLUDED.completed_at`,
            [
              uid,
              mod.module_name,
              level.level_name,
              level.status ?? "not_started",
              level.score ?? 0,
              level.attemptedTime ?? 0,
              level.noOfAttempts ?? 0,
              level.lastAttemptDate ?? null,
              level.completedAt ?? null,
            ]
          );
        }
      }

      const done: Record<string, string> = data.progress?.done ?? {};
      for (const [moduleCode, completedAt] of Object.entries(done)) {
        if (typeof completedAt !== "string") continue;
        await client.query(
          `INSERT INTO user_topic_progress (user_id, module_code, completed_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, module_code) DO UPDATE SET completed_at = EXCLUDED.completed_at`,
          [uid, moduleCode, completedAt]
        );
      }
    });

    count++;
  }

  return count;
}

async function migrateTeamPolicies(db: FirebaseFirestore.Firestore): Promise<number> {
  const snapshot = await db.collection("teamPolicies").get();
  let count = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (typeof data.allowedLevel !== "number") continue;

    await pool.query(
      `INSERT INTO team_policies (team, allowed_level)
       VALUES ($1, $2)
       ON CONFLICT (team) DO UPDATE SET allowed_level = EXCLUDED.allowed_level, updated_at = now()`,
      [doc.id, data.allowedLevel]
    );
    count++;
  }

  return count;
}

type QuestionDoc = {
  id?: string;
  questionText?: string;
  options?: string[];
  correctAnswer?: string;
};

async function migrateAssessments(db: FirebaseFirestore.Firestore): Promise<number> {
  const snapshot = await db.collection("assessments").get();
  let count = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const quizId = doc.id;

    if (
      typeof data.totalMarks !== "number" ||
      typeof data.passingPercentage !== "number" ||
      typeof data.timeLimit !== "number"
    ) {
      console.warn(`[migrate-from-firestore] Skipping assessment ${quizId}: missing required fields.`);
      continue;
    }

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO assessments (quiz_id, total_marks, passing_percentage, time_limit_minutes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (quiz_id) DO UPDATE SET
           total_marks = EXCLUDED.total_marks, passing_percentage = EXCLUDED.passing_percentage,
           time_limit_minutes = EXCLUDED.time_limit_minutes, updated_at = now()`,
        [quizId, data.totalMarks, data.passingPercentage, data.timeLimit]
      );

      await client.query(`DELETE FROM assessment_questions WHERE quiz_id = $1`, [quizId]);

      const questions: QuestionDoc[] = Array.isArray(data.questions) ? data.questions : [];
      let position = 0;
      for (const q of questions) {
        if (!q.questionText || !Array.isArray(q.options) || !q.correctAnswer) continue;
        await client.query(
          `INSERT INTO assessment_questions (id, quiz_id, question_text, options, correct_answer, position)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [q.id || randomUUID(), quizId, q.questionText, JSON.stringify(q.options), q.correctAnswer, position]
        );
        position++;
      }
    });

    count++;
  }

  return count;
}

async function main(): Promise<void> {
  const db = getDb();

  const userCount = await migrateUsers(db);
  console.log(`[migrate-from-firestore] Migrated ${userCount} user(s) (+ certifications + progress).`);

  const teamPolicyCount = await migrateTeamPolicies(db);
  console.log(`[migrate-from-firestore] Migrated ${teamPolicyCount} team policy/policies.`);

  const assessmentCount = await migrateAssessments(db);
  console.log(`[migrate-from-firestore] Migrated ${assessmentCount} assessment(s) (+ questions).`);

  console.log("[migrate-from-firestore] Done. (Skipped `syllabi` — out of scope, see migration plan.)");
}

main()
  .catch((err) => {
    console.error("[migrate-from-firestore] Failed:", (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => void closePool());
