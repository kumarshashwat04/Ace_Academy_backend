CREATE TABLE IF NOT EXISTS team_policies (
  team text PRIMARY KEY,
  allowed_level int NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
