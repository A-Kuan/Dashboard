CREATE TABLE IF NOT EXISTS catalog_dictionary_proposal (
  id text PRIMARY KEY,
  dictionary_code text NOT NULL CHECK (dictionary_code IN ('sku_brand','part_category','unit')),
  field text NOT NULL CHECK (field IN ('brand','category','unit')),
  source_value text NOT NULL,
  proposed_value text NOT NULL,
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected')),
  import_job_id text REFERENCES catalog_import_job(id) ON DELETE SET NULL,
  mapping_profile_id text REFERENCES catalog_import_mapping_profile(id) ON DELETE SET NULL,
  requested_by text NOT NULL,
  reviewed_by text,
  review_note text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_dictionary_proposal_source_nonempty CHECK (length(trim(source_value)) > 0),
  CONSTRAINT catalog_dictionary_proposal_value_nonempty CHECK (length(trim(proposed_value)) > 0),
  CONSTRAINT catalog_dictionary_proposal_reason_nonempty CHECK (length(trim(reason)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_dictionary_proposal_pending_value_unique
  ON catalog_dictionary_proposal (dictionary_code, lower(proposed_value))
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS catalog_dictionary_proposal_state_idx
  ON catalog_dictionary_proposal (state, created_at DESC);
