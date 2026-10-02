ALTER TABLE catalog_fitment
  ADD COLUMN IF NOT EXISTS review_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reviewed_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_version integer NOT NULL DEFAULT 1;

ALTER TABLE catalog_fitment
  ADD CONSTRAINT catalog_fitment_review_version_check CHECK (review_version > 0);

CREATE TABLE IF NOT EXISTS catalog_fitment_review_event (
  id text PRIMARY KEY,
  sku_id text NOT NULL REFERENCES catalog_sku(id) ON DELETE CASCADE,
  fitment_id text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  action text NOT NULL CHECK (action IN ('approve', 'reject', 'conflict')),
  note text NOT NULL,
  fitment_snapshot jsonb NOT NULL,
  sku_version integer NOT NULL CHECK (sku_version > 0),
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_fitment_review_queue_idx
  ON catalog_fitment (verification_status, created_at DESC);

CREATE INDEX IF NOT EXISTS catalog_fitment_review_event_sku_idx
  ON catalog_fitment_review_event (sku_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS catalog_fitment_review_event_fitment_idx
  ON catalog_fitment_review_event (fitment_id, changed_at DESC);
