ALTER TABLE catalog_import_mapping_profile
  ADD COLUMN IF NOT EXISTS value_mappings jsonb NOT NULL DEFAULT '{"brand":[],"category":[],"unit":[]}'::jsonb;

ALTER TABLE catalog_import_job
  ADD COLUMN IF NOT EXISTS review_rows integer NOT NULL DEFAULT 0;

ALTER TABLE catalog_import_mapping_profile_change
  DROP CONSTRAINT IF EXISTS catalog_import_mapping_profile_change_action;

ALTER TABLE catalog_import_mapping_profile_change
  ADD CONSTRAINT catalog_import_mapping_profile_change_action
  CHECK (action IN ('create','update_mapping','update_rules','update_value_mappings','rename','deactivate','reactivate','clone'));

ALTER TABLE catalog_import_job
  ADD CONSTRAINT catalog_import_job_review_rows_nonnegative CHECK (review_rows >= 0);
