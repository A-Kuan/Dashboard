CREATE TABLE IF NOT EXISTS catalog_vehicle_variant (
  id text PRIMARY KEY,
  platform_id text NOT NULL REFERENCES catalog_vehicle_platform(id) ON DELETE CASCADE,
  variant_code text NOT NULL,
  variant_label text NOT NULL,
  year_from integer,
  year_to integer,
  engine_codes text[] NOT NULL DEFAULT '{}',
  transmission_codes text[] NOT NULL DEFAULT '{}',
  market_codes text[] NOT NULL DEFAULT '{}',
  body_styles text[] NOT NULL DEFAULT '{}',
  drive_types text[] NOT NULL DEFAULT '{}',
  pr_codes text[] NOT NULL DEFAULT '{}',
  lifecycle_status text NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft','active','retired')),
  source_system text NOT NULL DEFAULT '',
  source_reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform_id, variant_code),
  CHECK (year_from IS NULL OR year_from BETWEEN 1900 AND 2200),
  CHECK (year_to IS NULL OR year_to BETWEEN 1900 AND 2200),
  CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
);

CREATE INDEX IF NOT EXISTS catalog_vehicle_variant_search_idx
  ON catalog_vehicle_variant (platform_id, lifecycle_status, variant_code);

CREATE TABLE IF NOT EXISTS catalog_vehicle_variant_change_event (
  id text PRIMARY KEY,
  variant_id text NOT NULL REFERENCES catalog_vehicle_variant(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  action text NOT NULL CHECK (action IN ('create','update')),
  snapshot jsonb NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_vehicle_variant_change_idx
  ON catalog_vehicle_variant_change_event (variant_id, version DESC, changed_at DESC);

ALTER TABLE catalog_fitment
  ADD COLUMN IF NOT EXISTS variant_master_id text REFERENCES catalog_vehicle_variant(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transmission_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS drive_types text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS catalog_fitment_variant_master_idx
  ON catalog_fitment (variant_master_id, year_from, year_to);

UPDATE catalog_fitment f
SET variant_master_id=v.id
FROM catalog_vehicle_variant v
WHERE f.variant_master_id IS NULL
  AND f.platform_master_id=v.platform_id
  AND upper(trim(f.vehicle_platform_id))=v.variant_code;
