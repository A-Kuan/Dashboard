#!/usr/bin/env bash
set -euo pipefail

deploy_root="${API_RESTORE_DEPLOY_ROOT:-/opt/dashboard-sku-api}"
if [[ ! "$deploy_root" =~ ^/opt/[A-Za-z0-9._/-]+$ ]]; then
  echo "Unsafe API_RESTORE_DEPLOY_ROOT: $deploy_root" >&2
  exit 2
fi
if (( EUID != 0 )); then
  echo "The offsite restore drill must run as root so it can use an isolated PostgreSQL database" >&2
  exit 2
fi

release_path="$(readlink -f "$deploy_root/current")"
if [[ "$release_path" != "$deploy_root"/releases/* ]] || [[ ! -f "$release_path/package.json" ]]; then
  echo "Current release is outside the managed API release root" >&2
  exit 2
fi

offsite_root="$deploy_root/offsite-restore-drills"
install -d -o root -g dashboard-sku -m 0750 "$offsite_root"
work_directory="$(mktemp -d "$offsite_root/download.XXXXXXXX")"
chmod 0750 "$work_directory"

cleanup() {
  if [[ "$work_directory" == "$offsite_root"/download.* ]]; then
    rm -rf -- "$work_directory"
  fi
}
trap cleanup EXIT

cd "$release_path"
download_json="$(node scripts/download-offsite-backup.mjs "$work_directory")"
download_status="$(DOWNLOAD_JSON="$download_json" node -e "const value=JSON.parse(process.env.DOWNLOAD_JSON);process.stdout.write(String(value.status||''))")"
if [[ "$download_status" == "disabled" ]]; then
  printf '%s\n' "$download_json"
  exit 0
fi
if [[ "$download_status" != "complete" ]]; then
  echo "Offsite download did not complete" >&2
  exit 1
fi

manifest_path="$(DOWNLOAD_JSON="$download_json" node -e "const value=JSON.parse(process.env.DOWNLOAD_JSON);process.stdout.write(String(value.manifestPath||''))")"
manifest_path="$(realpath -- "$manifest_path")"
if [[ "$manifest_path" != "$work_directory"/*.manifest.json ]] || [[ ! -f "$manifest_path" ]]; then
  echo "Downloaded manifest escaped the isolated work directory" >&2
  exit 2
fi
chown -R dashboard-sku:dashboard-sku "$work_directory"
restore_json="$(API_RESTORE_BACKUP_ROOT="$work_directory" "$release_path/scripts/run-api-restore-drill.sh" "$manifest_path")"

DOWNLOAD_JSON="$download_json" RESTORE_JSON="$restore_json" node - <<'NODE'
const download = JSON.parse(process.env.DOWNLOAD_JSON)
const restore = JSON.parse(process.env.RESTORE_JSON)
process.stdout.write(`${JSON.stringify({ status: 'passed', source: { provider: download.provider, bucket: download.bucket, region: download.region, prefix: download.prefix, releaseRevision: download.releaseRevision, objects: download.objects.length }, restore })}\n`)
NODE
