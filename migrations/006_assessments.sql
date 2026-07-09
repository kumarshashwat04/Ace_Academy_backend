CREATE TABLE IF NOT EXISTS assessments (
  quiz_id text PRIMARY KEY,
  total_marks int NOT NULL,
  passing_percentage int NOT NULL,
  time_limit_minutes int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
