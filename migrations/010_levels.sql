CREATE TABLE IF NOT EXISTS levels (
  id bigserial PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name text NOT NULL
);

CREATE INDEX IF NOT EXISTS levels_course_id_idx ON levels(course_id);
