#!/bin/sh
# ILMORA database backups to UzCloud Object Storage (runs inside the `backup` service on ilmora-admin).
#
#   backup.sh --schedule          every day at BACKUP_AT_UTC (the service's entrypoint)
#   backup.sh --now               one backup right away
#   backup.sh --list              list the stored backups
#   backup.sh --restore <name>    download + decrypt + restore into "<db>_restore"; the live database is NOT touched
#
# Run the manual modes with: docker compose exec backup backup.sh --now
# Each dump: pg_dump (custom format) → integrity check → AES-256 (openssl, passphrase BACKUP_PASSPHRASE) → BUCKET/db/
set -eu

# rclone (a single Go binary) talks to UzCloud's S3 the way SavdEx does: provider Other, path-style addresses.
# The remote "s3:" is defined by these variables only; no config file.
export RCLONE_CONFIG=/dev/null RCLONE_CONFIG_S3_TYPE=s3 RCLONE_CONFIG_S3_PROVIDER=Other RCLONE_CONFIG_S3_FORCE_PATH_STYLE=true \
  RCLONE_CONFIG_S3_NO_CHECK_BUCKET=true RCLONE_CONFIG_S3_ENDPOINT="$S3_ENDPOINT" \
  RCLONE_CONFIG_S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" RCLONE_CONFIG_S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
REMOTE="s3:${S3_BUCKET}/db"
WORK=/tmp/ilmora-backup

backup_once() {
  # A failed run must not leave an unencrypted dump behind for the next one.
  rm -rf "$WORK" && mkdir -p "$WORK"
  stamp=$(date -u +%Y%m%d-%H%M%S)
  dump="$WORK/ilmora-$stamp.dump"
  pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$dump"
  pg_restore --list "$dump" > /dev/null
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$dump" -out "$dump.enc"
  rclone copyto "$dump.enc" "$REMOTE/ilmora-$stamp.dump.enc"
  echo "backup stored: $REMOTE/ilmora-$stamp.dump.enc ($(du -h "$dump.enc" | cut -f1))"
  rm -rf "$WORK"

  rclone delete --min-age "${BACKUP_RETENTION_DAYS:-90}d" --include 'ilmora-*.dump.enc' "$REMOTE/"

  if [ -n "${BACKUP_PING_URL:-}" ]; then wget -qO- "$BACKUP_PING_URL" > /dev/null || echo "warning: ping failed"; fi
}

case "${1:-}" in
  --schedule)
    at="${BACKUP_AT_UTC:-22:40}"
    while :; do
      now=$(date -u +%s)
      next=$(date -u -d "$(date -u +%Y-%m-%d) $at:00" +%s)
      [ "$next" -le "$now" ] && next=$(( next + 86400 ))
      echo "next backup at $(date -u -d "@$next" '+%Y-%m-%d %H:%M') UTC"
      sleep $(( next - now ))
      # A separate process: inside `f || …` the shell ignores `set -e`, so a failed upload would look like success.
      sh "$0" --now || echo "BACKUP FAILED $(date -u '+%Y-%m-%d %H:%M') UTC"
    done
    ;;
  --now)
    trap 'rm -rf "$WORK"' EXIT
    backup_once
    ;;
  --list)
    rclone lsl "$REMOTE/" | sort -k2,3
    ;;
  --restore)
    name="${2:?usage: backup.sh --restore <ilmora-YYYYmmdd-HHMMSS.dump.enc>}"
    target="${PGDATABASE}_restore"
    trap 'rm -rf "$WORK"' EXIT
    rm -rf "$WORK" && mkdir -p "$WORK"
    rclone copyto "$REMOTE/$name" "$WORK/restore.enc"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$WORK/restore.enc" -out "$WORK/restore.dump"
    psql -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$target\";" -c "CREATE DATABASE \"$target\";"
    pg_restore --no-owner --no-privileges -d "$target" "$WORK/restore.dump"
    rm -rf "$WORK"
    echo "restored into database \"$target\". The live database \"$PGDATABASE\" is unchanged."
    echo "Swapping it in is a separate, deliberate step: infra/uzcloud/README.md, section «Восстановление»."
    ;;
  *)
    echo "usage: backup.sh --schedule | --now | --list | --restore <name>" >&2
    exit 2
    ;;
esac
