CREATE TABLE IF NOT EXISTS catalog_import_attempt (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES catalog_import_job(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  attempt_type text NOT NULL,
  state text NOT NULL DEFAULT 'running',
  selected_rows integer NOT NULL DEFAULT 0,
  imported_rows integer NOT NULL DEFAULT 0,
  failed_rows integer NOT NULL DEFAULT 0,
  started_by text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (job_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS catalog_import_attempt_job_idx
  ON catalog_import_attempt (job_id, attempt_number DESC);
