CREATE TABLE IF NOT EXISTS catalog_legacy_migration_batch (
  id text PRIMARY KEY,
  state text NOT NULL DEFAULT 'running',
  selected_count integer NOT NULL DEFAULT 0,
  migrated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS catalog_legacy_migration_batch_created_idx
  ON catalog_legacy_migration_batch (created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_legacy_sku_migration (
  legacy_sku_id text PRIMARY KEY REFERENCES sku(id) ON DELETE RESTRICT,
  catalog_sku_id text NOT NULL UNIQUE REFERENCES catalog_sku(id) ON DELETE RESTRICT,
  batch_id text NOT NULL REFERENCES catalog_legacy_migration_batch(id) ON DELETE RESTRICT,
  source_hash text NOT NULL,
  source_snapshot jsonb NOT NULL,
  mapping_snapshot jsonb NOT NULL,
  migrated_by text NOT NULL,
  migrated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_legacy_sku_migration_batch_idx
  ON catalog_legacy_sku_migration (batch_id, migrated_at);

CREATE TABLE IF NOT EXISTS catalog_legacy_migration_item (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES catalog_legacy_migration_batch(id) ON DELETE CASCADE,
  legacy_sku_id text NOT NULL,
  source_hash text NOT NULL DEFAULT '',
  state text NOT NULL,
  catalog_sku_id text REFERENCES catalog_sku(id) ON DELETE SET NULL,
  error_code text NOT NULL DEFAULT '',
  error_message text NOT NULL DEFAULT '',
  mapping_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_legacy_migration_item_batch_idx
  ON catalog_legacy_migration_item (batch_id, created_at);
