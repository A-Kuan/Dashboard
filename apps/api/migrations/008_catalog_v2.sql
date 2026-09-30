CREATE TABLE IF NOT EXISTS catalog_intake (
  id text PRIMARY KEY,
  source_type text NOT NULL,
  state text NOT NULL DEFAULT 'received',
  source_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS catalog_intake_created_at_idx ON catalog_intake (created_at DESC);
CREATE INDEX IF NOT EXISTS catalog_intake_source_type_idx ON catalog_intake (source_type, state);

CREATE TABLE IF NOT EXISTS catalog_sku (
  id text PRIMARY KEY,
  sku_code text NOT NULL UNIQUE,
  canonical_name_zh text NOT NULL DEFAULT '',
  canonical_name_en text NOT NULL DEFAULT '',
  brand_code text NOT NULL DEFAULT '',
  brand_label text NOT NULL DEFAULT '',
  category_code text NOT NULL DEFAULT '',
  category_label text NOT NULL DEFAULT '',
  unit_code text NOT NULL DEFAULT 'piece',
  unit_label text NOT NULL DEFAULT '件',
  lifecycle_status text NOT NULL DEFAULT 'draft',
  completeness_score integer NOT NULL DEFAULT 0,
  verification_level text NOT NULL DEFAULT 'unverified',
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS catalog_sku_updated_at_idx ON catalog_sku (updated_at DESC);
CREATE INDEX IF NOT EXISTS catalog_sku_status_idx ON catalog_sku (lifecycle_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS catalog_source_evidence (
  id text PRIMARY KEY,
  sku_id text NOT NULL REFERENCES catalog_sku(id) ON DELETE CASCADE,
  intake_id text REFERENCES catalog_intake(id) ON DELETE SET NULL,
  source_type text NOT NULL,
  source_system text NOT NULL DEFAULT '',
  source_record_id text NOT NULL DEFAULT '',
  catalog_path text NOT NULL DEFAULT '',
  figure_position text NOT NULL DEFAULT '',
  original_name text NOT NULL DEFAULT '',
  vin_context text NOT NULL DEFAULT '',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence text NOT NULL DEFAULT 'pending',
  immutable_hash text NOT NULL DEFAULT '',
  captured_at timestamptz NOT NULL DEFAULT now(),
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS catalog_source_evidence_sku_idx ON catalog_source_evidence (sku_id, sort_order);
CREATE INDEX IF NOT EXISTS catalog_source_evidence_record_idx ON catalog_source_evidence (source_system, source_record_id);

CREATE TABLE IF NOT EXISTS catalog_part_identifier (
  id text PRIMARY KEY,
  sku_id text NOT NULL REFERENCES catalog_sku(id) ON DELETE CASCADE,
  identifier_type text NOT NULL,
  raw_value text NOT NULL,
  normalized_value text NOT NULL,
  manufacturer_code text NOT NULL DEFAULT '',
  is_primary boolean NOT NULL DEFAULT false,
  source_evidence_id text REFERENCES catalog_source_evidence(id) ON DELETE SET NULL,
  verification_status text NOT NULL DEFAULT 'pending',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_part_identifier_sku_idx ON catalog_part_identifier (sku_id, sort_order);
CREATE INDEX IF NOT EXISTS catalog_part_identifier_value_idx ON catalog_part_identifier (normalized_value);
CREATE UNIQUE INDEX IF NOT EXISTS catalog_part_identifier_primary_idx ON catalog_part_identifier (sku_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS catalog_interchange_relation (
  id text PRIMARY KEY,
  sku_id text NOT NULL REFERENCES catalog_sku(id) ON DELETE CASCADE,
  from_identifier_id text REFERENCES catalog_part_identifier(id) ON DELETE CASCADE,
  to_identifier_id text REFERENCES catalog_part_identifier(id) ON DELETE CASCADE,
  relation_type text NOT NULL,
  direction text NOT NULL DEFAULT 'bidirectional',
  effective_from date,
  effective_to date,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_evidence_id text REFERENCES catalog_source_evidence(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_interchange_relation_sku_idx ON catalog_interchange_relation (sku_id, sort_order);

CREATE TABLE IF NOT EXISTS catalog_fitment (
  id text PRIMARY KEY,
  sku_id text NOT NULL REFERENCES catalog_sku(id) ON DELETE CASCADE,
  vehicle_platform_id text,
  vehicle_label text NOT NULL,
  years text NOT NULL DEFAULT '',
  year_from integer,
  year_to integer,
  engine_codes text[] NOT NULL DEFAULT '{}',
  market_codes text[] NOT NULL DEFAULT '{}',
  pr_codes text[] NOT NULL DEFAULT '{}',
  body_styles text[] NOT NULL DEFAULT '{}',
  position text NOT NULL DEFAULT '',
  include_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  exclude_conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_evidence_id text REFERENCES catalog_source_evidence(id) ON DELETE SET NULL,
  verification_status text NOT NULL DEFAULT 'pending',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_fitment_sku_idx ON catalog_fitment (sku_id, sort_order);
CREATE INDEX IF NOT EXISTS catalog_fitment_vehicle_idx ON catalog_fitment (vehicle_platform_id, vehicle_label);

CREATE TABLE IF NOT EXISTS catalog_change_log (
  id text PRIMARY KEY,
  sku_id text NOT NULL REFERENCES catalog_sku(id) ON DELETE CASCADE,
  version integer NOT NULL,
  action text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE catalog_change_log ADD COLUMN IF NOT EXISTS snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS catalog_change_log_sku_idx ON catalog_change_log (sku_id, version DESC, changed_at DESC);
