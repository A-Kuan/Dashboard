CREATE TABLE IF NOT EXISTS app_configuration (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
