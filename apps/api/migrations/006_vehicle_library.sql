CREATE TABLE IF NOT EXISTS vehicle_variant (
  id text PRIMARY KEY,
  vehicle_code text NOT NULL UNIQUE,
  brand text NOT NULL,
  series text NOT NULL,
  platform text NOT NULL,
  display_name text NOT NULL,
  displacement text NOT NULL DEFAULT '',
  engine_code text NOT NULL DEFAULT '',
  transmission_code text NOT NULL DEFAULT '',
  year_start integer,
  year_end integer,
  market text NOT NULL DEFAULT '',
  body_type text NOT NULL DEFAULT '',
  sample_vin text,
  production_date date,
  data_source text NOT NULL DEFAULT '',
  verification_status text NOT NULL DEFAULT '待验证',
  image_url text,
  source_evidence jsonb,
  lifecycle_status text NOT NULL DEFAULT '草稿',
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS vehicle_variant_search_idx ON vehicle_variant (brand, series, platform);
CREATE INDEX IF NOT EXISTS vehicle_variant_vin_idx ON vehicle_variant (sample_vin);

CREATE TABLE IF NOT EXISTS vehicle_part_requirement (
  id text PRIMARY KEY,
  vehicle_id text NOT NULL REFERENCES vehicle_variant(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT '',
  item_code text NOT NULL DEFAULT '',
  item_name text NOT NULL,
  position text NOT NULL DEFAULT '',
  side text NOT NULL DEFAULT '',
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  part_number text NOT NULL DEFAULT '',
  part_number_type text NOT NULL DEFAULT '',
  fitment_condition text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  verification_status text NOT NULL DEFAULT '待验证',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_part_requirement_vehicle_idx ON vehicle_part_requirement (vehicle_id, sort_order);
CREATE INDEX IF NOT EXISTS vehicle_part_requirement_number_idx ON vehicle_part_requirement (part_number);

CREATE TABLE IF NOT EXISTS vehicle_part_candidate (
  id text PRIMARY KEY,
  requirement_id text NOT NULL REFERENCES vehicle_part_requirement(id) ON DELETE CASCADE,
  sku_id text REFERENCES sku(id) ON DELETE SET NULL,
  part_number text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '备选',
  source text NOT NULL DEFAULT '',
  verification_status text NOT NULL DEFAULT '待验证',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requirement_id, sku_id)
);

CREATE INDEX IF NOT EXISTS vehicle_part_candidate_requirement_idx ON vehicle_part_candidate (requirement_id, sort_order);

CREATE TABLE IF NOT EXISTS vehicle_service_package (
  id text PRIMARY KEY,
  vehicle_id text NOT NULL REFERENCES vehicle_variant(id) ON DELETE CASCADE,
  package_code text NOT NULL,
  name text NOT NULL,
  interval_text text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  lifecycle_status text NOT NULL DEFAULT '启用',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, package_code)
);

CREATE INDEX IF NOT EXISTS vehicle_service_package_vehicle_idx ON vehicle_service_package (vehicle_id, sort_order);

CREATE TABLE IF NOT EXISTS vehicle_service_package_item (
  package_id text NOT NULL REFERENCES vehicle_service_package(id) ON DELETE CASCADE,
  requirement_id text NOT NULL REFERENCES vehicle_part_requirement(id) ON DELETE CASCADE,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (package_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS vehicle_change_log (
  id text PRIMARY KEY,
  vehicle_id text NOT NULL REFERENCES vehicle_variant(id) ON DELETE CASCADE,
  version integer NOT NULL,
  action text NOT NULL,
  details jsonb,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_change_log_vehicle_idx ON vehicle_change_log (vehicle_id, version DESC);
