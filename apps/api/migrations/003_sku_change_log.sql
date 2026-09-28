CREATE TABLE IF NOT EXISTS sku_change_log (
  id text PRIMARY KEY,
  sku_id text NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  version integer NOT NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sku_change_log_sku_idx ON sku_change_log (sku_id, version DESC);
