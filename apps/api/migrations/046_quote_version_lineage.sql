ALTER TABLE business_quote
  ADD COLUMN IF NOT EXISTS lineage_id text,
  ADD COLUMN IF NOT EXISTS version_no integer,
  ADD COLUMN IF NOT EXISTS predecessor_quote_id text REFERENCES business_quote(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS superseded_by_quote_id text REFERENCES business_quote(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS change_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

UPDATE business_quote
SET lineage_id=id,version_no=1
WHERE lineage_id IS NULL OR version_no IS NULL;

ALTER TABLE business_quote
  ALTER COLUMN lineage_id SET NOT NULL,
  ALTER COLUMN version_no SET NOT NULL,
  ALTER COLUMN version_no SET DEFAULT 1;

ALTER TABLE business_quote DROP CONSTRAINT IF EXISTS business_quote_state_check;
ALTER TABLE business_quote DROP CONSTRAINT IF EXISTS business_quote_version_no_check;
ALTER TABLE business_quote DROP CONSTRAINT IF EXISTS business_quote_lineage_shape_check;
ALTER TABLE business_quote
  ADD CONSTRAINT business_quote_state_check CHECK (state IN ('draft','sent','accepted','rejected','expired','superseded')),
  ADD CONSTRAINT business_quote_version_no_check CHECK (version_no>0),
  ADD CONSTRAINT business_quote_lineage_shape_check CHECK (
    (version_no=1 AND predecessor_quote_id IS NULL)
    OR (version_no>1 AND predecessor_quote_id IS NOT NULL AND change_reason<>'')
  );

CREATE UNIQUE INDEX IF NOT EXISTS business_quote_lineage_version_unique_idx
  ON business_quote(lineage_id,version_no);
CREATE INDEX IF NOT EXISTS business_quote_predecessor_idx
  ON business_quote(predecessor_quote_id)
  WHERE predecessor_quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_quote_active_inquiry_idx
  ON business_quote(inquiry_id,state,sent_at DESC,created_at DESC)
  WHERE state IN ('draft','sent','accepted');

CREATE TABLE IF NOT EXISTS business_quote_revision_event (
  id text PRIMARY KEY,
  inquiry_id text NOT NULL REFERENCES business_inquiry(id) ON DELETE CASCADE,
  lineage_id text NOT NULL,
  from_quote_id text REFERENCES business_quote(id) ON DELETE RESTRICT,
  to_quote_id text NOT NULL REFERENCES business_quote(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('created','revised','superseded','expired','accepted','rejected')),
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  reason text NOT NULL DEFAULT '',
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(after_snapshot)='object'),
  change_set jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(change_set)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_quote_revision_event_inquiry_idx
  ON business_quote_revision_event(inquiry_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS business_quote_revision_event_lineage_idx
  ON business_quote_revision_event(lineage_id,created_at DESC,id DESC);
