CREATE TABLE IF NOT EXISTS user_topic_progress (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_code text NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, module_code)
);
