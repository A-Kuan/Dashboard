ALTER TABLE catalog_sku ADD COLUMN IF NOT EXISTS review_assignee text NOT NULL DEFAULT '';
ALTER TABLE catalog_sku ADD COLUMN IF NOT EXISTS review_note text NOT NULL DEFAULT '';
ALTER TABLE catalog_sku ADD COLUMN IF NOT EXISTS review_submitted_at timestamptz;
ALTER TABLE catalog_sku ADD COLUMN IF NOT EXISTS review_due_at timestamptz;
ALTER TABLE catalog_sku ADD COLUMN IF NOT EXISTS discontinued_reason text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS catalog_sku_review_queue_idx
  ON catalog_sku (lifecycle_status, review_due_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS catalog_review_event (
  id text PRIMARY KEY,
  sku_id text NOT NULL REFERENCES catalog_sku(id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status text NOT NULL,
  action text NOT NULL,
  note text NOT NULL DEFAULT '',
  assignee text NOT NULL DEFAULT '',
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  sku_version integer NOT NULL
);

CREATE INDEX IF NOT EXISTS catalog_review_event_sku_idx
  ON catalog_review_event (sku_id, changed_at DESC);
