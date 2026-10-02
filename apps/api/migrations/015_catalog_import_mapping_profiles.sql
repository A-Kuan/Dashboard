CREATE TABLE IF NOT EXISTS catalog_import_mapping_profile (
  id text PRIMARY KEY,
  name text NOT NULL,
  source_name_pattern text NOT NULL DEFAULT '',
  header_signature text NOT NULL,
  source_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  field_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL DEFAULT 'system',
  updated_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_import_mapping_profile_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT catalog_import_mapping_profile_usage_nonnegative CHECK (usage_count >= 0),
  CONSTRAINT catalog_import_mapping_profile_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_import_mapping_profile_name_unique
  ON catalog_import_mapping_profile (lower(name));

CREATE INDEX IF NOT EXISTS catalog_import_mapping_profile_signature_idx
  ON catalog_import_mapping_profile (header_signature)
  WHERE active;

ALTER TABLE catalog_import_job
  ADD COLUMN IF NOT EXISTS mapping_profile_id text REFERENCES catalog_import_mapping_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mapping_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
