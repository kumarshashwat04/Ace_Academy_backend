CREATE TABLE IF NOT EXISTS courses (
  id text PRIMARY KEY,
  name text NOT NULL,
  subject text,
  icon text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
