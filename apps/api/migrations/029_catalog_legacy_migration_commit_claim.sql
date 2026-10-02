ALTER TABLE catalog_legacy_migration_plan
  DROP CONSTRAINT IF EXISTS catalog_legacy_migration_plan_state_check;

ALTER TABLE catalog_legacy_migration_plan
  ADD CONSTRAINT catalog_legacy_migration_plan_state_check
  CHECK (state IN ('submitted','approved','committing','rejected','committed','cancelled'));
