ALTER TABLE catalog_import_mapping_profile_change
  DROP CONSTRAINT IF EXISTS catalog_import_mapping_profile_change_action;

ALTER TABLE catalog_import_mapping_profile_change
  ADD CONSTRAINT catalog_import_mapping_profile_change_action
  CHECK (action IN ('create','update_mapping','update_rules','update_value_mappings','resolve_value_mapping','rename','deactivate','reactivate','clone'));

CREATE TABLE IF NOT EXISTS catalog_import_value_resolution (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES catalog_import_job(id) ON DELETE CASCADE,
  mapping_profile_id text NOT NULL REFERENCES catalog_import_mapping_profile(id),
  field text NOT NULL CHECK (field IN ('brand','category','unit')),
  source_value text NOT NULL,
  target_value text NOT NULL,
  profile_version integer NOT NULL CHECK (profile_version > 0),
  resolved_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_import_value_resolution_job_idx
  ON catalog_import_value_resolution (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS catalog_import_value_resolution_profile_idx
  ON catalog_import_value_resolution (mapping_profile_id, created_at DESC);
