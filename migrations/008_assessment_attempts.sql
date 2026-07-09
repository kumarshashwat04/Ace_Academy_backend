CREATE TABLE IF NOT EXISTS assessment_attempts (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  quiz_id text NOT NULL REFERENCES assessments(quiz_id),
  score int NOT NULL,
  passed boolean NOT NULL,
  attempted_time_seconds int NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assessment_attempts_user_id_idx ON assessment_attempts(user_id);
