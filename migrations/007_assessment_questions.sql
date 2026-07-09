CREATE TABLE IF NOT EXISTS assessment_questions (
  id uuid PRIMARY KEY,
  quiz_id text NOT NULL REFERENCES assessments(quiz_id) ON DELETE CASCADE,
  question_text text NOT NULL,
  options jsonb NOT NULL,
  correct_answer text NOT NULL,
  position int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS assessment_questions_quiz_id_idx ON assessment_questions(quiz_id);
