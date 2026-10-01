CREATE TABLE IF NOT EXISTS catalog_sku_merge (
  id text PRIMARY KEY,
  survivor_sku_id text NOT NULL REFERENCES catalog_sku(id),
  retired_sku_id text NOT NULL REFERENCES catalog_sku(id),
  normalized_value text NOT NULL,
  reason text NOT NULL,
  survivor_version_before integer NOT NULL,
  retired_version_before integer NOT NULL,
  survivor_snapshot_before jsonb NOT NULL,
  retired_snapshot_before jsonb NOT NULL,
  survivor_snapshot_after jsonb NOT NULL,
  merged_by text NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  CHECK (survivor_sku_id <> retired_sku_id),
  UNIQUE (retired_sku_id)
);

CREATE INDEX IF NOT EXISTS catalog_sku_merge_survivor_idx
  ON catalog_sku_merge (survivor_sku_id, merged_at DESC);

CREATE INDEX IF NOT EXISTS catalog_sku_merge_merged_at_idx
  ON catalog_sku_merge (merged_at DESC);
