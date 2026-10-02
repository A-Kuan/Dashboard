CREATE TABLE IF NOT EXISTS catalog_epc_connector_run (
  id text PRIMARY KEY,
  connector_id text NOT NULL,
  state text NOT NULL DEFAULT 'running' CHECK (state IN ('running','succeeded','failed')),
  request_context jsonb NOT NULL,
  response_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview_id text REFERENCES catalog_epc_preview(id) ON DELETE SET NULL,
  retry_of text REFERENCES catalog_epc_connector_run(id) ON DELETE RESTRICT,
  error_code text NOT NULL DEFAULT '',
  error_message text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((state = 'running' AND completed_at IS NULL) OR (state <> 'running' AND completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS catalog_epc_connector_run_state_idx
  ON catalog_epc_connector_run (state, started_at DESC);

CREATE INDEX IF NOT EXISTS catalog_epc_connector_run_connector_idx
  ON catalog_epc_connector_run (connector_id, started_at DESC);

CREATE INDEX IF NOT EXISTS catalog_epc_connector_run_retry_idx
  ON catalog_epc_connector_run (retry_of, started_at DESC)
  WHERE retry_of IS NOT NULL;
