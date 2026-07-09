CREATE TABLE IF NOT EXISTS resources (
  id bigserial PRIMARY KEY,
  module_id bigint NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  label text NOT NULL,
  type text NOT NULL,
  url text NOT NULL
);

CREATE INDEX IF NOT EXISTS resources_module_id_idx ON resources(module_id);
