CREATE TABLE IF NOT EXISTS modules (
  id bigserial PRIMARY KEY,
  topic_id bigint NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS modules_topic_id_idx ON modules(topic_id);
