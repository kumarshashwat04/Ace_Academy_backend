CREATE TABLE IF NOT EXISTS certification_levels (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_name text NOT NULL,
  level_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('not_started', 'not_attempted', 'in_progress', 'completed', 'locked')),
  score int NOT NULL DEFAULT 0,
  attempted_time_seconds int NOT NULL DEFAULT 0,
  no_of_attempts int NOT NULL DEFAULT 0,
  last_attempt_date timestamptz,
  completed_at timestamptz,
  UNIQUE (user_id, module_name, level_name)
);

CREATE INDEX IF NOT EXISTS certification_levels_user_id_idx ON certification_levels(user_id);
