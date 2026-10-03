#!/usr/bin/env bash
set -euo pipefail

revision_ref="${1:-origin/main}"
deploy_host="${API_DEPLOY_HOST:-root@121.41.24.42}"
deploy_root="${API_DEPLOY_ROOT:-/opt/dashboard-sku-api}"
preview_url="${API_DEPLOY_PREVIEW_URL:-https://121.41.24.42/sku-preview/}"
allow_non_main="${API_DEPLOY_ALLOW_NON_MAIN:-0}"
allow_data_change="${API_DEPLOY_ALLOW_DATA_CHANGE:-0}"
allow_insecure_tls="${API_DEPLOY_ALLOW_INSECURE_TLS:-0}"
skip_browser_smoke="${API_DEPLOY_SKIP_BROWSER_SMOKE:-0}"
dry_run="${API_DEPLOY_DRY_RUN:-0}"
connect_timeout="${API_DEPLOY_CONNECT_TIMEOUT:-10}"
ssh_options=(-o BatchMode=yes -o ConnectTimeout="$connect_timeout")

if [[ ! "$deploy_root" =~ ^/opt/[A-Za-z0-9._/-]+$ ]]; then
  echo "Unsafe API_DEPLOY_ROOT: $deploy_root" >&2
  exit 2
fi

repository_root="$(git rev-parse --show-toplevel)"
cd "$repository_root"
git fetch origin main --quiet
revision_sha="$(git rev-parse "${revision_ref}^{commit}")"
main_sha="$(git rev-parse "origin/main^{commit}")"

if [[ ! "$revision_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Revision did not resolve to a full Git SHA" >&2
  exit 2
fi
if [[ "$revision_sha" != "$main_sha" && !( "$dry_run" == "1" && "$allow_non_main" == "1" ) ]]; then
  echo "Refusing to deploy $revision_sha because protected origin/main is $main_sha" >&2
  exit 2
fi

release_id="${API_DEPLOY_RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)-${revision_sha:0:8}}"
if [[ ! "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]]; then
  echo "Unsafe API_DEPLOY_RELEASE_ID: $release_id" >&2
  exit 2
fi
release_path="$deploy_root/releases/$release_id"

if [[ "$dry_run" == "1" ]]; then
  printf 'deploy_host=%s\ndeploy_root=%s\nrevision=%s\nrelease=%s\npreview_url=%s\n' \
    "$deploy_host" "$deploy_root" "$revision_sha" "$release_path" "$preview_url"
  exit 0
fi

for command in git ssh npm curl node; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 2; }
done
if [[ "$skip_browser_smoke" != "1" && ! -x apps/web/node_modules/.bin/playwright ]]; then
  echo "Missing apps/web Playwright dependencies; run npm ci in apps/web before deploying" >&2
  exit 2
fi

previous_path="$(ssh "${ssh_options[@]}" "$deploy_host" bash -s -- "$deploy_root" <<'REMOTE'
set -euo pipefail
deploy_root="$1"
test "$(systemctl is-active dashboard-sku-api.service)" = "active"
curl -fsS http://127.0.0.1:4183/api/ready >/dev/null
readlink -f "$deploy_root/current"
REMOTE
)"
if [[ "$previous_path" != "$deploy_root"/releases/* ]]; then
  echo "Current API target is outside the managed release root: $previous_path" >&2
  exit 2
fi

production_counts() {
  ssh "${ssh_options[@]}" "$deploy_host" bash -s <<'REMOTE'
set -euo pipefail
sudo -u dashboard-sku psql -d dashboard_sku -Atc "SELECT json_build_object(
  'legacySku',(SELECT count(*) FROM sku),
  'legacyOe',(SELECT count(*) FROM sku_oe_relation),
  'legacyFitment',(SELECT count(*) FROM sku_fitment),
  'catalogSku',(SELECT count(*) FROM catalog_sku),
  'migrationBatch',(SELECT count(*) FROM catalog_legacy_migration_batch),
  'migrationPlan',(SELECT count(*) FROM catalog_legacy_migration_plan),
  'migrationItem',(SELECT count(*) FROM catalog_legacy_migration_plan_item),
  'migrationEvent',(SELECT count(*) FROM catalog_legacy_migration_plan_event)
)::text"
REMOTE
}

production_business_counts() {
  ssh "${ssh_options[@]}" "$deploy_host" bash -s <<'REMOTE'
set -euo pipefail
sudo -u dashboard-sku psql -d dashboard_sku -qAt <<'SQL'
CREATE OR REPLACE FUNCTION pg_temp.exact_count(table_name text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE result bigint;
BEGIN
  IF to_regclass(format('public.%I', table_name)) IS NULL THEN RETURN NULL; END IF;
  EXECUTE format('SELECT count(*) FROM %I', table_name) INTO result;
  RETURN result;
END $$;
SELECT json_build_object(
  'businessInquiry',pg_temp.exact_count('business_inquiry'),
  'businessInquiryItem',pg_temp.exact_count('business_inquiry_item'),
  'businessSupplierOffer',pg_temp.exact_count('business_supplier_offer'),
  'businessQuote',pg_temp.exact_count('business_quote'),
  'businessQuoteItem',pg_temp.exact_count('business_quote_item'),
  'businessInquiryEvent',pg_temp.exact_count('business_inquiry_event'),
  'businessPartner',pg_temp.exact_count('business_partner'),
  'businessPartnerContact',pg_temp.exact_count('business_partner_contact'),
  'businessCustomerVehicle',pg_temp.exact_count('business_customer_vehicle'),
  'businessPartnerEvent',pg_temp.exact_count('business_partner_event'),
  'businessSalesOrder',pg_temp.exact_count('business_sales_order'),
  'businessSalesOrderItem',pg_temp.exact_count('business_sales_order_item'),
  'businessPurchaseOrder',pg_temp.exact_count('business_purchase_order'),
  'businessPurchaseOrderItem',pg_temp.exact_count('business_purchase_order_item'),
  'businessOrderEvent',pg_temp.exact_count('business_order_event')
)::text;
SQL
REMOTE
}

baseline_counts="$(production_counts)"
baseline_business_counts="$(production_business_counts)"

ssh "${ssh_options[@]}" "$deploy_host" bash -s -- "$release_path" <<'REMOTE'
set -euo pipefail
release_path="$1"
test ! -e "$release_path"
install -d -o dashboard-sku -g dashboard-sku -m 0750 "$release_path"
REMOTE

git archive --format=tar "${revision_sha}:apps/api" | ssh "${ssh_options[@]}" "$deploy_host" "tar -xf - -C '$release_path'"
git show "${revision_sha}:deploy/run-api-restore-drill.sh" | ssh "${ssh_options[@]}" "$deploy_host" "cat >'$release_path/scripts/run-api-restore-drill.sh'"

ssh "${ssh_options[@]}" "$deploy_host" bash -s -- "$release_path" "$revision_sha" "$deploy_root" <<'REMOTE'
set -euo pipefail
release_path="$1"
revision_sha="$2"
deploy_root="$3"
printf '%s\n' "$revision_sha" >"$release_path/REVISION"
chown -R dashboard-sku:dashboard-sku "$release_path"
chmod 0640 "$release_path/REVISION"
chmod 0750 "$release_path/scripts/run-api-restore-drill.sh"
chmod 0750 "$release_path/scripts/run-offsite-restore-drill.sh"
cd "$release_path"
sudo -u dashboard-sku npm ci --omit=dev
sudo -u dashboard-sku npm test

backup_json="$(sudo -u dashboard-sku flock -w 300 "$deploy_root/backups/.backup.lock" env \
  PGDATABASE=dashboard_sku PGUSER=dashboard-sku \
  CATALOG_BACKUP_DIR="$deploy_root/backups" \
  CATALOG_EPC_ASSET_DIR="$deploy_root/data/epc-assets" \
  RELEASE_REVISION="$revision_sha" \
  BACKUP_PURPOSE=release \
  npm run --silent backup)"
manifest_path="$(printf '%s' "$backup_json" | node -e "let value='';process.stdin.on('data',(chunk)=>value+=chunk);process.stdin.on('end',()=>process.stdout.write(JSON.parse(value).manifestPath))")"
sudo -u dashboard-sku npm run --silent backup:verify -- "$manifest_path"
MANIFEST_PATH="$manifest_path" node -e "const fs=require('fs');const manifest=JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH,'utf8'));if(!manifest.assetArchive)throw new Error('Release backup is missing the EPC asset snapshot')"
sudo -u dashboard-sku env PGDATABASE=dashboard_sku PGUSER=dashboard-sku npm run migrate
printf 'backup_manifest=%s\n' "$manifest_path"
REMOTE

switched=0
completed=0

rollback_release() {
  if [[ "$switched" != "1" || "$completed" == "1" ]]; then return; fi
  echo "Release verification failed; rolling back API to $previous_path" >&2
  ssh "${ssh_options[@]}" "$deploy_host" bash -s -- "$deploy_root" "$previous_path" <<'REMOTE'
set -euo pipefail
deploy_root="$1"
previous_path="$2"
next_link="$deploy_root/current.next"
ln -sfn "$previous_path" "$next_link"
mv -Tf "$next_link" "$deploy_root/current"
systemctl restart dashboard-sku-api.service
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4183/api/ready >/dev/null; then exit 0; fi
  sleep 1
done
exit 1
REMOTE
}
trap rollback_release EXIT

ssh "${ssh_options[@]}" "$deploy_host" bash -s -- "$deploy_root" "$release_path" "$revision_sha" "$previous_path" <<'REMOTE'
set -euo pipefail
deploy_root="$1"
release_path="$2"
revision_sha="$3"
previous_path="$4"
next_link="$deploy_root/current.next"
ln -sfn "$release_path" "$next_link"
mv -Tf "$next_link" "$deploy_root/current"
if ! systemctl restart dashboard-sku-api.service; then
  ln -sfn "$previous_path" "$next_link"
  mv -Tf "$next_link" "$deploy_root/current"
  systemctl restart dashboard-sku-api.service
  exit 1
fi

ready_body=''
for _ in $(seq 1 20); do
  if ready_body="$(curl -fsS http://127.0.0.1:4183/api/ready)"; then break; fi
  sleep 1
done
if ! READY_BODY="$ready_body" EXPECTED_REVISION="$revision_sha" node -e "const body=JSON.parse(process.env.READY_BODY||'{}');if(body.status!=='ready'||body.releaseRevision!==process.env.EXPECTED_REVISION)process.exit(1)"; then
  ln -sfn "$previous_path" "$next_link"
  mv -Tf "$next_link" "$deploy_root/current"
  systemctl restart dashboard-sku-api.service
  exit 1
fi
REMOTE
switched=1

after_counts="$(production_counts)"
if [[ "$after_counts" != "$baseline_counts" && "$allow_data_change" != "1" ]]; then
  echo "Production data fingerprint changed unexpectedly" >&2
  echo "before=$baseline_counts" >&2
  echo "after=$after_counts" >&2
  exit 1
fi
after_business_counts="$(production_business_counts)"
safe_business_schema_change=0
if BASELINE_COUNTS="$baseline_business_counts" AFTER_COUNTS="$after_business_counts" node -e "const before=JSON.parse(process.env.BASELINE_COUNTS);const after=JSON.parse(process.env.AFTER_COUNTS);if(Object.keys(after).every((key)=>before[key]===after[key]||(before[key]===null&&after[key]===0)))process.exit(0);process.exit(1)"; then
  safe_business_schema_change=1
fi
if [[ "$after_business_counts" != "$baseline_business_counts" && "$safe_business_schema_change" != "1" && "$allow_data_change" != "1" ]]; then
  echo "Production business data fingerprint changed unexpectedly" >&2
  echo "before=$baseline_business_counts" >&2
  echo "after=$after_business_counts" >&2
  exit 1
fi

curl_flags=(--fail --silent --show-error)
if [[ "$allow_insecure_tls" == "1" ]]; then curl_flags+=(--insecure); fi
ready_body="$(curl "${curl_flags[@]}" "${preview_url%/}/api/ready")"
READY_BODY="$ready_body" EXPECTED_REVISION="$revision_sha" node -e "const body=JSON.parse(process.env.READY_BODY||'{}');if(body.status!=='ready'||body.releaseRevision!==process.env.EXPECTED_REVISION)process.exit(1)"

if [[ "$skip_browser_smoke" != "1" ]]; then
  tls_reject=1
  if [[ "$allow_insecure_tls" == "1" ]]; then tls_reject=0; fi
  (cd apps/web && PLAYWRIGHT_BASE_URL="$preview_url" NODE_TLS_REJECT_UNAUTHORIZED="$tls_reject" npm run test:production-smoke)
fi

completed=1
trap - EXIT
printf 'released=%s\nrevision=%s\nprevious=%s\ncounts=%s\nbusiness_counts=%s\n' "$release_path" "$revision_sha" "$previous_path" "$after_counts" "$after_business_counts"
