CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, -- Firebase uid
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  team text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'learner')),
  allowed_level int NOT NULL DEFAULT 0,
  allowed_level_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
