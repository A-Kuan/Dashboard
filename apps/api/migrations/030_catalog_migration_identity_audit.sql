ALTER TABLE catalog_legacy_migration_plan
  ADD COLUMN IF NOT EXISTS created_by_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_by_role text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reviewed_by_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reviewed_by_role text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS committed_by_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS committed_by_role text NOT NULL DEFAULT '';

UPDATE catalog_legacy_migration_plan
SET created_by_id = CASE WHEN created_by_id='' THEN 'legacy:' || created_by ELSE created_by_id END,
    reviewed_by_id = CASE WHEN reviewed_by_id='' AND reviewed_by<>'' THEN 'legacy:' || reviewed_by ELSE reviewed_by_id END,
    committed_by_id = CASE WHEN committed_by_id='' AND committed_by<>'' THEN 'legacy:' || committed_by ELSE committed_by_id END;

CREATE TABLE IF NOT EXISTS catalog_legacy_migration_plan_event (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES catalog_legacy_migration_plan(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('submitted','approved','rejected','commit_started','committed','commit_failed')),
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  actor_role text NOT NULL DEFAULT '',
  identity_provider text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_legacy_migration_plan_event_plan_idx
  ON catalog_legacy_migration_plan_event (plan_id, created_at, id);
