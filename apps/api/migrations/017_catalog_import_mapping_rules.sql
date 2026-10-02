ALTER TABLE catalog_import_mapping_profile
  ADD COLUMN IF NOT EXISTS default_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS transform_rules jsonb NOT NULL DEFAULT '{"trimText":true,"collapseWhitespace":true,"uppercaseOe":true,"normalizeFullWidth":true}'::jsonb;

ALTER TABLE catalog_import_mapping_profile_change
  DROP CONSTRAINT IF EXISTS catalog_import_mapping_profile_change_action;

ALTER TABLE catalog_import_mapping_profile_change
  ADD CONSTRAINT catalog_import_mapping_profile_change_action
  CHECK (action IN ('create','update_mapping','update_rules','rename','deactivate','reactivate','clone'));
