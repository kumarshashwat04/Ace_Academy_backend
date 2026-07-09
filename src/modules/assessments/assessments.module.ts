import { randomUUID } from "crypto";
import { Router } from "express";
import { asyncHandler } from "../../core/asyncHandler";
import { ApiError } from "../../core/ApiError";
import { query, queryOne } from "../../db/query";
import { withTransaction } from "../../db/transaction";
import { getNextLevelName, parseQuizId, VALID_QUIZ_IDS } from "./quiz-mapping";

const router = Router();

type AssessmentRow = {
  quiz_id: string;
  total_marks: number;
  passing_percentage: number;
  time_limit_minutes: number;
};

type QuestionRow = {
  id: string;
  question_text: string;
  options: string[];
  correct_answer: string;
};

function toAssessmentJson(row: AssessmentRow, questions?: QuestionRow[]) {
  return {
    id: row.quiz_id,
    quizId: row.quiz_id,
    totalMarks: row.total_marks,
    passingPercentage: row.passing_percentage,
    timeLimit: row.time_limit_minutes,
    ...(questions
      ? {
          questions: questions.map((q) => ({
            id: q.id,
            questionText: q.question_text,
            options: q.options,
            correctAnswer: q.correct_answer,
          })),
        }
      : {}),
  };
}

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await query<AssessmentRow>(
      `SELECT quiz_id, total_marks, passing_percentage, time_limit_minutes FROM assessments ORDER BY quiz_id`
    );
    res.json({ assessments: rows.map((r) => toAssessmentJson(r)) });
  })
);

router.get(
  "/:quiz_id",
  asyncHandler(async (req, res) => {
    const { quiz_id } = req.params;
    const assessment = await queryOne<AssessmentRow>(
      `SELECT quiz_id, total_marks, passing_percentage, time_limit_minutes FROM assessments WHERE quiz_id = $1`,
      [quiz_id]
    );
    if (!assessment) throw ApiError.notFound(`Assessment with ID '${quiz_id}' not found.`);

    const questions = await query<QuestionRow>(
      `SELECT id, question_text, options, correct_answer FROM assessment_questions WHERE quiz_id = $1 ORDER BY position`,
      [quiz_id]
    );

    res.json(toAssessmentJson(assessment, questions));
  })
);

type UpsertQuestion = {
  id?: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
};

/**
 * PUT /api/assessments/:quiz_id
 *
 * Upserts the assessment's metadata and replaces its full question set,
 * in one transaction (mirrors the previous "set with merge" Firestore write).
 */
router.put(
  "/:quiz_id",
  asyncHandler(async (req, res) => {
    const { quiz_id } = req.params;
    if (!VALID_QUIZ_IDS.includes(quiz_id)) {
      throw ApiError.badRequest(`Invalid quizId: ${quiz_id}`);
    }

    const { totalMarks, passingPercentage, timeLimit, questions } = req.body ?? {};
    if (
      typeof totalMarks !== "number" ||
      typeof passingPercentage !== "number" ||
      typeof timeLimit !== "number" ||
      !Array.isArray(questions)
    ) {
      throw ApiError.badRequest(
        "totalMarks, passingPercentage, timeLimit, and questions[] are required."
      );
    }

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO assessments (quiz_id, total_marks, passing_percentage, time_limit_minutes, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (quiz_id) DO UPDATE SET
           total_marks = EXCLUDED.total_marks,
           passing_percentage = EXCLUDED.passing_percentage,
           time_limit_minutes = EXCLUDED.time_limit_minutes,
           updated_at = now()`,
        [quiz_id, totalMarks, passingPercentage, timeLimit]
      );

      await client.query(`DELETE FROM assessment_questions WHERE quiz_id = $1`, [quiz_id]);

      let position = 0;
      for (const q of questions as UpsertQuestion[]) {
        await client.query(
          `INSERT INTO assessment_questions (id, quiz_id, question_text, options, correct_answer, position)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [q.id || randomUUID(), quiz_id, q.questionText, JSON.stringify(q.options), q.correctAnswer, position]
        );
        position += 1;
      }
    });

    res.json({ ok: true, message: `Assessment '${quiz_id}' successfully updated/created.` });
  })
);

type SubmitBody = {
  user_id?: string;
  score?: number;
  attemptedTimeSeconds?: number;
};

/**
 * POST /api/assessments/:quiz_id/submit
 *
 * Transactional equivalent of ACE-Academy/lib/apply-assessment-result.ts:
 * looks up the matching certification_levels row, applies the
 * score/status/unlock-next-level rules, logs the attempt.
 */
router.post(
  "/:quiz_id/submit",
  asyncHandler(async (req, res) => {
    const { quiz_id } = req.params;
    const { user_id, score, attemptedTimeSeconds } = (req.body ?? {}) as SubmitBody;

    if (!user_id || typeof score !== "number" || typeof attemptedTimeSeconds !== "number") {
      throw ApiError.badRequest("user_id, score, and attemptedTimeSeconds are required.");
    }
    if (score < 0 || score > 100) {
      throw ApiError.badRequest("score must be between 0 and 100.");
    }
    if (attemptedTimeSeconds < 0) {
      throw ApiError.badRequest("attemptedTimeSeconds must be non-negative.");
    }

    const parsed = parseQuizId(quiz_id);
    if (!parsed) {
      throw ApiError.badRequest(`Invalid quizId: ${quiz_id}`);
    }
    const { moduleName, levelName } = parsed;

    const result = await withTransaction(async (client) => {
      const assessmentRows = await client.query<AssessmentRow>(
        `SELECT quiz_id, total_marks, passing_percentage, time_limit_minutes FROM assessments WHERE quiz_id = $1`,
        [quiz_id]
      );
      const assessment = assessmentRows.rows[0];
      if (!assessment) {
        throw ApiError.notFound(`Assessment '${quiz_id}' not found.`);
      }
      const passingPercentage = assessment.passing_percentage;

      const levelRows = await client.query(
        `SELECT * FROM certification_levels
          WHERE user_id = $1 AND module_name = $2 AND level_name = $3
          FOR UPDATE`,
        [user_id, moduleName, levelName]
      );
      const currentLevel = levelRows.rows[0];
      if (!currentLevel) {
        throw ApiError.badRequest(`Certification level not found: ${moduleName} / ${levelName}`);
      }
      if (currentLevel.status === "locked") {
        throw ApiError.badRequest(`Certification level is locked: ${moduleName} / ${levelName}`);
      }

      const attemptedAt = new Date();
      const previousScore = currentLevel.score;
      const newScore = score > previousScore ? score : previousScore;
      const scoreUpdated = newScore > previousScore;
      const passed = score >= passingPercentage;

      let status = currentLevel.status;
      if (["not_started", "not_attempted", "in_progress"].includes(currentLevel.status)) {
        status = passed ? "completed" : "in_progress";
      }

      let completedAt = currentLevel.completed_at;
      if (passed && !completedAt) completedAt = attemptedAt;

      await client.query(
        `UPDATE certification_levels
            SET score = $1, status = $2, no_of_attempts = no_of_attempts + 1,
                last_attempt_date = $3, attempted_time_seconds = attempted_time_seconds + $4,
                completed_at = $5
          WHERE user_id = $6 AND module_name = $7 AND level_name = $8`,
        [newScore, status, attemptedAt, attemptedTimeSeconds, completedAt, user_id, moduleName, levelName]
      );

      let nextLevelUnlocked: string | null = null;
      if (passed) {
        const nextLevelName = getNextLevelName(levelName);
        if (nextLevelName) {
          const nextRows = await client.query(
            `SELECT status FROM certification_levels WHERE user_id = $1 AND module_name = $2 AND level_name = $3`,
            [user_id, moduleName, nextLevelName]
          );
          if (nextRows.rows[0]?.status === "locked") {
            await client.query(
              `UPDATE certification_levels SET status = 'not_started'
                WHERE user_id = $1 AND module_name = $2 AND level_name = $3`,
              [user_id, moduleName, nextLevelName]
            );
            nextLevelUnlocked = nextLevelName;
          }
        }
      }

      await client.query(
        `INSERT INTO assessment_attempts (user_id, quiz_id, score, passed, attempted_time_seconds, attempted_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user_id, quiz_id, score, passed, attemptedTimeSeconds, attemptedAt]
      );

      return {
        passed,
        scoreUpdated,
        previousScore,
        newScore,
        levelCompleted: passed,
        nextLevelUnlocked,
        passingPercentage,
      };
    });

    res.json({ ok: true, quizId: quiz_id, ...result });
  })
);

export default router;
