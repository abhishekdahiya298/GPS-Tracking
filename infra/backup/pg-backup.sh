#!/usr/bin/env bash
# Nightly PostgreSQL backup for RIO GPS (both the `rio` and `traccar` databases).
#
#  1. pg_dump (custom format) each database from the running postgres container
#  2. verify each dump is readable (pg_restore --list)
#  3. optionally encrypt (gpg, symmetric) if /etc/rio-gps/backup.passphrase exists
#  4. optionally upload off-site to DigitalOcean Spaces (S3 API) if
#     /etc/rio-gps/backup.env exists (SPACES_* variables, see docs/DISASTER_RECOVERY.md)
#  5. prune local copies older than LOCAL_RETENTION_DAYS
#
# Never prints credentials. Exits non-zero on any failure so the systemd unit
# (and anything watching it) reports the failure instead of hiding it.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/rio-gps}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/rio-gps}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-14}"
CONTAINER="${PG_CONTAINER:-rio-gps-postgres-1}"
PASSPHRASE_FILE=/etc/rio-gps/backup.passphrase
OFFSITE_ENV=/etc/rio-gps/backup.env

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dest="${BACKUP_ROOT}/${stamp}"
umask 077
mkdir -p "${dest}"

log() { printf '{"timestamp":"%s","service":"rio-gps-backup","event":"%s"%s}\n' "$(date -u +%FT%TZ)" "$1" "${2:-}"; }

for db in rio traccar; do
  out="${dest}/${db}.dump"
  docker exec "${CONTAINER}" pg_dump -U postgres -d "${db}" -Fc --no-owner > "${out}"
  # Verify the archive is structurally valid before trusting it.
  docker exec -i "${CONTAINER}" pg_restore --list < "${out}" > /dev/null
  size="$(stat -c %s "${out}")"
  if [ "${size}" -lt 1024 ]; then
    log "backup.too_small" ",\"database\":\"${db}\",\"bytes\":${size}"
    exit 1
  fi
  if [ -f "${PASSPHRASE_FILE}" ]; then
    gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "${PASSPHRASE_FILE}" \
      --symmetric --cipher-algo AES256 -o "${out}.gpg" "${out}"
    rm -f "${out}"
    out="${out}.gpg"
  fi
  sha256sum "${out}" > "${out}.sha256"
  log "backup.dump_ok" ",\"database\":\"${db}\",\"bytes\":${size},\"file\":\"${out}\""
done

if [ -f "${OFFSITE_ENV}" ]; then
  # shellcheck disable=SC1090
  set -a; . "${OFFSITE_ENV}"; set +a
  : "${SPACES_BUCKET:?SPACES_BUCKET missing in ${OFFSITE_ENV}}"
  : "${SPACES_ENDPOINT:?SPACES_ENDPOINT missing in ${OFFSITE_ENV}}"
  docker run --rm \
    -e AWS_ACCESS_KEY_ID="${SPACES_ACCESS_KEY_ID}" \
    -e AWS_SECRET_ACCESS_KEY="${SPACES_SECRET_ACCESS_KEY}" \
    -e AWS_DEFAULT_REGION="${SPACES_REGION:-us-east-1}" \
    -v "${dest}:/backup:ro" \
    amazon/aws-cli:2.22.35 s3 cp /backup "s3://${SPACES_BUCKET}/rio-gps/${stamp}/" \
      --recursive --endpoint-url "${SPACES_ENDPOINT}" --only-show-errors
  log "backup.offsite_ok" ",\"bucket\":\"${SPACES_BUCKET}\",\"prefix\":\"rio-gps/${stamp}/\""
else
  log "backup.offsite_skipped" ",\"reason\":\"${OFFSITE_ENV} not present\""
fi

find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -mtime "+${LOCAL_RETENTION_DAYS}" -exec rm -rf {} +
log "backup.done" ",\"dir\":\"${dest}\""
