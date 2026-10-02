CREATE TABLE IF NOT EXISTS catalog_import_mapping_profile_change (
  id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES catalog_import_mapping_profile(id) ON DELETE CASCADE,
  action text NOT NULL,
  version integer NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_import_mapping_profile_change_action CHECK (action IN ('create','update_mapping','rename','deactivate','reactivate','clone')),
  CONSTRAINT catalog_import_mapping_profile_change_version_positive CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS catalog_import_mapping_profile_change_profile_idx
  ON catalog_import_mapping_profile_change (profile_id, created_at DESC);
