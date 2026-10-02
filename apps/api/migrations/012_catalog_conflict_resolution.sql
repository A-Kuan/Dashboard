CREATE TABLE IF NOT EXISTS catalog_identifier_resolution (
  id text PRIMARY KEY,
  normalized_value text NOT NULL,
  sku_id_a text NOT NULL REFERENCES catalog_sku(id) ON DELETE CASCADE,
  sku_id_b text NOT NULL REFERENCES catalog_sku(id) ON DELETE CASCADE,
  resolution_type text NOT NULL,
  note text NOT NULL DEFAULT '',
  resolved_by text NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  CHECK (sku_id_a < sku_id_b),
  CHECK (resolution_type IN ('shared_reference','separate_scope','merge_required')),
  UNIQUE (normalized_value, sku_id_a, sku_id_b)
);

CREATE INDEX IF NOT EXISTS catalog_identifier_resolution_sku_a_idx
  ON catalog_identifier_resolution (sku_id_a, active, resolved_at DESC);

CREATE INDEX IF NOT EXISTS catalog_identifier_resolution_sku_b_idx
  ON catalog_identifier_resolution (sku_id_b, active, resolved_at DESC);
