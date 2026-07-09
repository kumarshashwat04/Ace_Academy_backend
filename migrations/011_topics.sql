CREATE TABLE IF NOT EXISTS topics (
  id bigserial PRIMARY KEY,
  level_id bigint NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  title text NOT NULL
);

CREATE INDEX IF NOT EXISTS topics_level_id_idx ON topics(level_id);
