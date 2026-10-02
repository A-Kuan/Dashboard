CREATE TABLE IF NOT EXISTS catalog_epc_preview (
  id text PRIMARY KEY,
  intake_id text NOT NULL UNIQUE REFERENCES catalog_intake(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'preview' CHECK (state IN ('preview','partial','completed')),
  vin text NOT NULL DEFAULT '',
  source_system text NOT NULL,
  catalog_path text NOT NULL DEFAULT '',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_epc_preview_state_idx
  ON catalog_epc_preview (state, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_epc_preview_item (
  id text PRIMARY KEY,
  preview_id text NOT NULL REFERENCES catalog_epc_preview(id) ON DELETE CASCADE,
  row_number integer NOT NULL CHECK (row_number > 0),
  source_record_id text NOT NULL DEFAULT '',
  raw_oe text NOT NULL,
  normalized_oe text NOT NULL,
  original_name text NOT NULL,
  figure_position text NOT NULL DEFAULT '',
  vehicle_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_state text NOT NULL CHECK (match_state IN ('exact','new','ambiguous')),
  matched_sku_id text REFERENCES catalog_sku(id) ON DELETE SET NULL,
  match_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  platform_match jsonb NOT NULL DEFAULT '{}'::jsonb,
  variant_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_state text NOT NULL DEFAULT 'pending' CHECK (decision_state IN ('pending','created','attached','skipped')),
  resulting_sku_id text REFERENCES catalog_sku(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (preview_id, row_number)
);

CREATE INDEX IF NOT EXISTS catalog_epc_preview_item_preview_idx
  ON catalog_epc_preview_item (preview_id, row_number);

CREATE TABLE IF NOT EXISTS catalog_epc_publish_decision (
  id text PRIMARY KEY,
  preview_id text NOT NULL REFERENCES catalog_epc_preview(id) ON DELETE RESTRICT,
  item_id text NOT NULL REFERENCES catalog_epc_preview_item(id) ON DELETE RESTRICT,
  decision_type text NOT NULL CHECK (decision_type IN ('create_sku','attach_evidence','skip')),
  target_sku_id text REFERENCES catalog_sku(id) ON DELETE SET NULL,
  source_snapshot jsonb NOT NULL,
  write_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id)
);

CREATE INDEX IF NOT EXISTS catalog_epc_publish_decision_preview_idx
  ON catalog_epc_publish_decision (preview_id, decided_at DESC);
