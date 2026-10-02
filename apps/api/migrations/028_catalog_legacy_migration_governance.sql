CREATE TABLE IF NOT EXISTS catalog_legacy_migration_plan (
  id text PRIMARY KEY,
  state text NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted','approved','rejected','committed','cancelled')),
  reason text NOT NULL,
  migrate_count integer NOT NULL DEFAULT 0,
  exclude_count integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text NOT NULL DEFAULT '',
  reviewed_at timestamptz,
  review_note text NOT NULL DEFAULT '',
  committed_batch_id text REFERENCES catalog_legacy_migration_batch(id) ON DELETE RESTRICT,
  committed_by text NOT NULL DEFAULT '',
  committed_at timestamptz
);

CREATE INDEX IF NOT EXISTS catalog_legacy_migration_plan_state_idx
  ON catalog_legacy_migration_plan (state, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_legacy_migration_plan_item (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES catalog_legacy_migration_plan(id) ON DELETE CASCADE,
  legacy_sku_id text NOT NULL REFERENCES sku(id) ON DELETE RESTRICT,
  source_hash text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('migrate','exclude')),
  exclusion_reason text NOT NULL DEFAULT '',
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview_snapshot jsonb NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, legacy_sku_id)
);

CREATE INDEX IF NOT EXISTS catalog_legacy_migration_plan_item_plan_idx
  ON catalog_legacy_migration_plan_item (plan_id, sort_order, created_at);
