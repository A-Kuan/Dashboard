CREATE TABLE IF NOT EXISTS catalog_epc_asset (
  id text PRIMARY KEY,
  intake_id text NOT NULL REFERENCES catalog_intake(id) ON DELETE CASCADE,
  asset_type text NOT NULL CHECK (asset_type IN ('diagram','image','document')),
  source_url text NOT NULL,
  source_record_id text NOT NULL DEFAULT '',
  figure_code text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  declared_content_type text NOT NULL DEFAULT '',
  expected_checksum text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','mirroring','stored','failed','corrupt')),
  storage_key text NOT NULL DEFAULT '',
  content_type text NOT NULL DEFAULT '',
  byte_size bigint NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  checksum_sha256 text NOT NULL DEFAULT '',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code text NOT NULL DEFAULT '',
  last_error_message text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  mirrored_at timestamptz,
  verified_at timestamptz,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS catalog_epc_asset_intake_idx
  ON catalog_epc_asset (intake_id, created_at, id);

CREATE INDEX IF NOT EXISTS catalog_epc_asset_state_idx
  ON catalog_epc_asset (state, updated_at DESC);

CREATE INDEX IF NOT EXISTS catalog_epc_asset_checksum_idx
  ON catalog_epc_asset (checksum_sha256)
  WHERE checksum_sha256 <> '';

CREATE TABLE IF NOT EXISTS catalog_epc_asset_attempt (
  id text PRIMARY KEY,
  asset_id text NOT NULL REFERENCES catalog_epc_asset(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('mirror','verify')),
  state text NOT NULL DEFAULT 'running' CHECK (state IN ('running','succeeded','failed')),
  error_code text NOT NULL DEFAULT '',
  error_message text NOT NULL DEFAULT '',
  checksum_sha256 text NOT NULL DEFAULT '',
  byte_size bigint NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  created_by text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((state = 'running' AND completed_at IS NULL) OR (state <> 'running' AND completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS catalog_epc_asset_attempt_asset_idx
  ON catalog_epc_asset_attempt (asset_id, started_at DESC, id);
