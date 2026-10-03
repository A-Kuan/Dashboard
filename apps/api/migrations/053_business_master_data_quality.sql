CREATE TABLE IF NOT EXISTS business_master_data_quality_decision (
  id text PRIMARY KEY,
  request_key text NOT NULL UNIQUE,
  issue_key text NOT NULL,
  issue_kind text NOT NULL CHECK (issue_kind IN ('customer_duplicate','vehicle_duplicate')),
  issue_fingerprint text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('not_duplicate','deferred')),
  reason text NOT NULL,
  deferred_until timestamptz,
  snapshot jsonb NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(reason))>=8),
  CHECK (jsonb_typeof(snapshot)='object'),
  CHECK ((decision='deferred' AND deferred_until IS NOT NULL) OR (decision='not_duplicate' AND deferred_until IS NULL))
);

CREATE INDEX IF NOT EXISTS business_master_data_quality_decision_issue_idx
  ON business_master_data_quality_decision(issue_key,created_at DESC,id DESC);

CREATE INDEX IF NOT EXISTS business_master_data_quality_decision_deferred_idx
  ON business_master_data_quality_decision(deferred_until)
  WHERE decision='deferred';

CREATE INDEX IF NOT EXISTS business_partner_quality_phone_idx
  ON business_partner(regexp_replace(phone,'[^0-9]','','g'))
  WHERE phone<>'' AND merged_into_partner_id IS NULL;

CREATE INDEX IF NOT EXISTS business_partner_quality_name_idx
  ON business_partner(lower(regexp_replace(name,'\s','','g')))
  WHERE status='active' AND merged_into_partner_id IS NULL;

CREATE INDEX IF NOT EXISTS business_partner_quality_short_name_idx
  ON business_partner(lower(regexp_replace(short_name,'\s','','g')))
  WHERE short_name<>'' AND status='active' AND merged_into_partner_id IS NULL;

CREATE INDEX IF NOT EXISTS business_partner_contact_quality_phone_idx
  ON business_partner_contact(regexp_replace(phone,'[^0-9]','','g'),partner_id)
  WHERE phone<>'';

CREATE INDEX IF NOT EXISTS business_customer_vehicle_quality_plate_idx
  ON business_customer_vehicle(upper(license_plate))
  WHERE license_plate<>'' AND merged_into_vehicle_id IS NULL;

CREATE INDEX IF NOT EXISTS business_customer_vehicle_quality_model_idx
  ON business_customer_vehicle(partner_id,platform_master_id,lower(regexp_replace(vehicle_label,'\s','','g')))
  WHERE platform_master_id IS NOT NULL AND merged_into_vehicle_id IS NULL;
