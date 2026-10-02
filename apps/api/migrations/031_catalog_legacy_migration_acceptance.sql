ALTER TABLE catalog_legacy_migration_plan
  ADD COLUMN IF NOT EXISTS acceptance_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS acceptance_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS acceptance_by_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS acceptance_by_role text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS acceptance_at timestamptz,
  ADD COLUMN IF NOT EXISTS acceptance_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS acceptance_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE catalog_legacy_migration_plan
  DROP CONSTRAINT IF EXISTS catalog_legacy_migration_plan_acceptance_state_check;

ALTER TABLE catalog_legacy_migration_plan
  ADD CONSTRAINT catalog_legacy_migration_plan_acceptance_state_check
  CHECK (acceptance_state IN ('pending','changes_required','accepted'));

ALTER TABLE catalog_legacy_migration_plan_event
  DROP CONSTRAINT IF EXISTS catalog_legacy_migration_plan_event_action_check;

ALTER TABLE catalog_legacy_migration_plan_event
  ADD CONSTRAINT catalog_legacy_migration_plan_event_action_check
  CHECK (action IN ('submitted','approved','rejected','commit_started','committed','commit_failed','acceptance_changes_required','acceptance_passed'));
