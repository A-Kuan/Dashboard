CREATE TABLE IF NOT EXISTS catalog_import_job (
  id text PRIMARY KEY,
  intake_id text NOT NULL REFERENCES catalog_intake(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  state text NOT NULL DEFAULT 'preview',
  total_rows integer NOT NULL DEFAULT 0,
  ready_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  imported_rows integer NOT NULL DEFAULT 0,
  failed_rows integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS catalog_import_job_created_idx ON catalog_import_job (created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_import_row (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES catalog_import_job(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  normalized_payload jsonb NOT NULL,
  state text NOT NULL,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  duplicate_matches jsonb NOT NULL DEFAULT '[]'::jsonb,
  imported_sku_id text REFERENCES catalog_sku(id) ON DELETE SET NULL,
  error_message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, row_number)
);

CREATE INDEX IF NOT EXISTS catalog_import_row_job_idx ON catalog_import_row (job_id, row_number);
CREATE INDEX IF NOT EXISTS catalog_import_row_state_idx ON catalog_import_row (job_id, state);
