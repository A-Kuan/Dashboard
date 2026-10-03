CREATE TABLE IF NOT EXISTS business_master_data_quality_task (
  issue_key text PRIMARY KEY,
  issue_kind text NOT NULL CHECK (issue_kind IN ('customer_duplicate','vehicle_duplicate')),
  issue_fingerprint text NOT NULL,
  assigned_to_id text NOT NULL,
  assigned_to_name text NOT NULL,
  due_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(assigned_to_id)) BETWEEN 1 AND 128),
  CHECK (length(trim(assigned_to_name)) BETWEEN 1 AND 160)
);

CREATE INDEX IF NOT EXISTS business_master_data_quality_task_assignee_idx
  ON business_master_data_quality_task(assigned_to_id,due_at,updated_at DESC);

CREATE INDEX IF NOT EXISTS business_master_data_quality_task_due_idx
  ON business_master_data_quality_task(due_at,updated_at DESC);

CREATE TABLE IF NOT EXISTS business_master_data_quality_task_event (
  id text PRIMARY KEY,
  request_key text NOT NULL UNIQUE,
  issue_key text NOT NULL REFERENCES business_master_data_quality_task(issue_key),
  issue_kind text NOT NULL CHECK (issue_kind IN ('customer_duplicate','vehicle_duplicate')),
  issue_fingerprint text NOT NULL,
  action text NOT NULL CHECK (action IN ('assigned','reassigned','due_changed','assignment_updated')),
  reason text NOT NULL,
  before_snapshot jsonb,
  after_snapshot jsonb NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(reason)) BETWEEN 8 AND 500),
  CHECK (before_snapshot IS NULL OR jsonb_typeof(before_snapshot)='object'),
  CHECK (jsonb_typeof(after_snapshot)='object')
);

CREATE INDEX IF NOT EXISTS business_master_data_quality_task_event_issue_idx
  ON business_master_data_quality_task_event(issue_key,created_at DESC,id DESC);
