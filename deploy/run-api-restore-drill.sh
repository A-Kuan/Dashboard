#!/usr/bin/env bash
set -euo pipefail

manifest_input="${1:-}"
deploy_root="${API_RESTORE_DEPLOY_ROOT:-/opt/dashboard-sku-api}"
restore_port="${API_RESTORE_PORT:-14183}"

if [[ ! "$deploy_root" =~ ^/opt/[A-Za-z0-9._/-]+$ ]]; then
  echo "Unsafe API_RESTORE_DEPLOY_ROOT: $deploy_root" >&2
  exit 2
fi
if [[ ! "$restore_port" =~ ^[0-9]+$ ]] || (( restore_port < 1024 || restore_port > 65535 || restore_port == 4183 )); then
  echo "Unsafe API_RESTORE_PORT: $restore_port" >&2
  exit 2
fi
if [[ -z "$manifest_input" ]]; then
  echo "Usage: sudo deploy/run-api-restore-drill.sh /opt/dashboard-sku-api/backups/<backup>.manifest.json" >&2
  exit 2
fi
if (( EUID != 0 )); then
  echo "The production restore drill must run as root so it can create and remove only its isolated database" >&2
  exit 2
fi

manifest_path="$(realpath -- "$manifest_input")"
managed_backup_root="$(realpath -- "$deploy_root/backups")"
offsite_restore_root="$(realpath -m -- "$deploy_root/offsite-restore-drills")"
backup_root="$(realpath -- "${API_RESTORE_BACKUP_ROOT:-$managed_backup_root}")"
release_path="$(readlink -f "$deploy_root/current")"
if [[ "$backup_root" != "$managed_backup_root" && "$backup_root" != "$offsite_restore_root"/download.* ]]; then
  echo "Backup root must be the managed backup directory or an isolated offsite download directory" >&2
  exit 2
fi
if [[ "$manifest_path" != "$backup_root"/*.manifest.json ]] || [[ ! -f "$manifest_path" ]]; then
  echo "Manifest must be an existing file directly inside $backup_root" >&2
  exit 2
fi
if [[ "$release_path" != "$deploy_root"/releases/* ]] || [[ ! -f "$release_path/package.json" ]]; then
  echo "Current release is outside the managed API release root" >&2
  exit 2
fi

restore_root="$deploy_root/restore-drills"
install -d -o dashboard-sku -g dashboard-sku -m 0750 "$restore_root"
work_directory="$(mktemp -d "$restore_root/drill.XXXXXXXX")"
chown dashboard-sku:dashboard-sku "$work_directory"
chmod 0750 "$work_directory"
restore_database="dashboard_sku_restore_$(date -u +%Y%m%d%H%M%S)_${RANDOM}"
if [[ ! "$restore_database" =~ ^dashboard_sku_restore_[a-z0-9_]+$ ]]; then
  echo "Unsafe restore database name: $restore_database" >&2
  exit 2
fi

api_pid=''
cleanup() {
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  if [[ "$restore_database" =~ ^dashboard_sku_restore_[a-z0-9_]+$ ]]; then
    sudo -u postgres dropdb --if-exists "$restore_database" >/dev/null 2>&1 || true
  fi
  if [[ "$work_directory" == "$restore_root"/drill.* ]]; then
    rm -rf -- "$work_directory"
  fi
}
trap cleanup EXIT

cd "$release_path"
sudo -u dashboard-sku npm run --silent backup:verify -- "$manifest_path" >/dev/null

dump_filename="$(MANIFEST_PATH="$manifest_path" node -e "const fs=require('fs');const value=JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH,'utf8'));process.stdout.write(value.archive.filename)")"
dump_path="$(realpath -- "$(dirname "$manifest_path")/$dump_filename")"
if [[ "$dump_path" != "$backup_root"/*.dump ]] || [[ ! -f "$dump_path" ]]; then
  echo "Backup archive resolved outside $backup_root" >&2
  exit 2
fi

server_major="$(MANIFEST_PATH="$manifest_path" node -e "const fs=require('fs');const value=JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH,'utf8'));process.stdout.write(String(value.postgres?.serverMajorVersion||''))")"
pg_restore_bin="/usr/lib/postgresql/$server_major/bin/pg_restore"
if [[ -z "$server_major" || ! -x "$pg_restore_bin" ]]; then pg_restore_bin="$(command -v pg_restore)"; fi

sudo -u postgres createdb --owner=dashboard-sku "$restore_database"
sudo -u dashboard-sku "$pg_restore_bin" --host /var/run/postgresql --port 5432 --username dashboard-sku \
  --dbname "$restore_database" --no-owner --no-privileges "$dump_path"

database_environment=(PGHOST=/var/run/postgresql PGPORT=5432 PGDATABASE="$restore_database" PGUSER=dashboard-sku)
sudo -u dashboard-sku env "${database_environment[@]}" npm run --silent restore:verify -- "$manifest_path" before-migrate >/dev/null

asset_filename="$(MANIFEST_PATH="$manifest_path" node -e "const fs=require('fs');const value=JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH,'utf8'));process.stdout.write(value.assetArchive?.filename||'')")"
restored_asset_count=0
if [[ -n "$asset_filename" ]]; then
  asset_path="$(realpath -- "$(dirname "$manifest_path")/$asset_filename")"
  if [[ "$asset_path" != "$backup_root"/*.epc-assets.tar.gz ]] || [[ ! -f "$asset_path" ]]; then
    echo "EPC asset archive resolved outside $backup_root" >&2
    exit 2
  fi
  install -d -o dashboard-sku -g dashboard-sku -m 0750 "$work_directory/epc-assets"
  sudo -u dashboard-sku tar -xzf "$asset_path" -C "$work_directory/epc-assets"
  restored_asset_count="$(find "$work_directory/epc-assets" -type f | wc -l | tr -d ' ')"
fi

sudo -u dashboard-sku env "${database_environment[@]}" npm run --silent migrate >/dev/null
sudo -u dashboard-sku env "${database_environment[@]}" npm run --silent restore:verify -- "$manifest_path" after-migrate >/dev/null

if curl -fsS --max-time 1 "http://127.0.0.1:$restore_port/api/health" >/dev/null 2>&1; then
  echo "Restore drill port is already in use: $restore_port" >&2
  exit 2
fi
sudo -u dashboard-sku env "${database_environment[@]}" HOST=127.0.0.1 PORT="$restore_port" \
  node src/server.mjs >"$work_directory/api.log" 2>&1 &
api_pid=$!

ready_body=''
for _ in $(seq 1 20); do
  if ready_body="$(curl -fsS "http://127.0.0.1:$restore_port/api/ready")"; then break; fi
  sleep 1
done
if ! READY_BODY="$ready_body" RESTORE_DATABASE="$restore_database" node -e "const body=JSON.parse(process.env.READY_BODY||'{}');if(body.status!=='ready'||body.databaseName!==process.env.RESTORE_DATABASE)process.exit(1)"; then
  cat "$work_directory/api.log" >&2
  echo "Restored API did not become ready against the isolated database" >&2
  exit 1
fi
curl -fsS "http://127.0.0.1:$restore_port/api/v1/skus" >/dev/null
curl -fsS "http://127.0.0.1:$restore_port/api/v2/catalog/skus?page=1&pageSize=1" >/dev/null
curl -fsS "http://127.0.0.1:$restore_port/api/metrics" | grep -q '^dashboard_api_build_info'

kill "$api_pid"
wait "$api_pid" || true
api_pid=''

MANIFEST_PATH="$manifest_path" RESTORE_DATABASE="$restore_database" READY_BODY="$ready_body" ASSET_COUNT="$restored_asset_count" \
  node -e "const body=JSON.parse(process.env.READY_BODY);process.stdout.write(JSON.stringify({status:'passed',manifestPath:process.env.MANIFEST_PATH,isolatedDatabase:process.env.RESTORE_DATABASE,releaseRevision:body.releaseRevision,migrations:body.migrations,latestMigration:body.latestMigration,restoredAssetFiles:Number(process.env.ASSET_COUNT)})+'\\n')"
