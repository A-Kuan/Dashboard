CREATE TABLE IF NOT EXISTS business_quick_quote_draft (
  id text PRIMARY KEY,
  draft_no text NOT NULL UNIQUE,
  autosave_key text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  customer_partner_id text REFERENCES business_partner(id) ON DELETE SET NULL,
  customer_vehicle_id text REFERENCES business_customer_vehicle(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  submission_request_key text NOT NULL DEFAULT '',
  submission_error jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_inquiry_id text REFERENCES business_inquiry(id) ON DELETE SET NULL,
  submitted_quote_id text REFERENCES business_quote(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_by_id text NOT NULL DEFAULT '',
  created_by_name text NOT NULL DEFAULT '',
  updated_by_id text NOT NULL DEFAULT '',
  updated_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  abandoned_at timestamptz,
  CONSTRAINT business_quick_quote_draft_status_check
    CHECK (status IN ('active','submitting','submitted','abandoned')),
  CONSTRAINT business_quick_quote_draft_payload_check
    CHECK (jsonb_typeof(payload)='object'),
  CONSTRAINT business_quick_quote_draft_submission_error_check
    CHECK (jsonb_typeof(submission_error)='object'),
  CONSTRAINT business_quick_quote_draft_version_check
    CHECK (version>0),
  CONSTRAINT business_quick_quote_draft_submission_shape_check
    CHECK (
      (status IN ('active','abandoned') AND submitted_inquiry_id IS NULL AND submitted_quote_id IS NULL)
      OR (status='submitting' AND submission_request_key<>'')
      OR (status='submitted' AND submission_request_key<>'' AND submitted_inquiry_id IS NOT NULL AND submitted_quote_id IS NOT NULL AND submitted_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS business_quick_quote_draft_autosave_owner_unique_idx
  ON business_quick_quote_draft(created_by_id,autosave_key);

CREATE INDEX IF NOT EXISTS business_quick_quote_draft_resume_idx
  ON business_quick_quote_draft(status,updated_at DESC,id DESC);

CREATE INDEX IF NOT EXISTS business_quick_quote_draft_customer_idx
  ON business_quick_quote_draft(customer_partner_id,updated_at DESC)
  WHERE customer_partner_id IS NOT NULL;

ALTER TABLE business_quote
  ADD COLUMN IF NOT EXISTS source_draft_id text REFERENCES business_quick_quote_draft(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS business_quote_source_draft_unique_idx
  ON business_quote(source_draft_id)
  WHERE source_draft_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS business_quick_quote_draft_event (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES business_quick_quote_draft(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_version integer,
  to_version integer NOT NULL,
  actor_id text NOT NULL DEFAULT '',
  actor_name text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_quick_quote_draft_event_action_check
    CHECK (action IN ('created','saved','submission_started','submission_failed','submitted','abandoned')),
  CONSTRAINT business_quick_quote_draft_event_snapshot_check
    CHECK (jsonb_typeof(snapshot)='object')
);

CREATE INDEX IF NOT EXISTS business_quick_quote_draft_event_draft_idx
  ON business_quick_quote_draft_event(draft_id,created_at DESC,id DESC);
