CREATE TABLE IF NOT EXISTS catalog_vehicle_platform (
  id text PRIMARY KEY,
  platform_code text NOT NULL UNIQUE,
  brand_code text NOT NULL DEFAULT '',
  brand_label text NOT NULL,
  series_code text NOT NULL DEFAULT '',
  series_label text NOT NULL,
  generation_label text NOT NULL DEFAULT '',
  year_from integer,
  year_to integer,
  market_codes text[] NOT NULL DEFAULT '{}',
  body_styles text[] NOT NULL DEFAULT '{}',
  aliases text[] NOT NULL DEFAULT '{}',
  lifecycle_status text NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft','active','retired')),
  source_system text NOT NULL DEFAULT '',
  source_reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (year_from IS NULL OR year_from BETWEEN 1900 AND 2200),
  CHECK (year_to IS NULL OR year_to BETWEEN 1900 AND 2200),
  CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
);

CREATE INDEX IF NOT EXISTS catalog_vehicle_platform_search_idx
  ON catalog_vehicle_platform (lifecycle_status, brand_label, series_label, platform_code);

CREATE TABLE IF NOT EXISTS catalog_vehicle_platform_change_event (
  id text PRIMARY KEY,
  platform_id text NOT NULL REFERENCES catalog_vehicle_platform(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  action text NOT NULL CHECK (action IN ('create','update')),
  snapshot jsonb NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_vehicle_platform_change_idx
  ON catalog_vehicle_platform_change_event (platform_id, version DESC, changed_at DESC);

ALTER TABLE catalog_fitment
  ADD COLUMN IF NOT EXISTS platform_master_id text REFERENCES catalog_vehicle_platform(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS catalog_fitment_platform_master_idx
  ON catalog_fitment (platform_master_id, year_from, year_to);

CREATE TABLE IF NOT EXISTS catalog_fitment_scope_resolution (
  id text PRIMARY KEY,
  conflict_key text NOT NULL UNIQUE,
  conflict_type text NOT NULL CHECK (conflict_type IN ('overlapping_scope','shared_oe_scope')),
  fitment_id_a text NOT NULL,
  fitment_id_b text NOT NULL,
  sku_id_a text NOT NULL REFERENCES catalog_sku(id) ON DELETE CASCADE,
  sku_id_b text NOT NULL REFERENCES catalog_sku(id) ON DELETE CASCADE,
  platform_id text REFERENCES catalog_vehicle_platform(id) ON DELETE SET NULL,
  resolution_type text NOT NULL CHECK (resolution_type IN ('accepted_overlap','same_application','correction_required')),
  note text NOT NULL,
  conflict_snapshot jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  resolved_by text NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_fitment_scope_resolution_sku_idx
  ON catalog_fitment_scope_resolution (sku_id_a, sku_id_b, active, resolved_at DESC);

UPDATE catalog_fitment f
SET platform_master_id=p.id
FROM catalog_vehicle_platform p
WHERE f.platform_master_id IS NULL
  AND (upper(trim(f.vehicle_platform_id))=p.platform_code OR upper(trim(f.vehicle_platform_id))=ANY(p.aliases));
