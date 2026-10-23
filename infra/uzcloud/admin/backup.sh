#!/bin/sh
# ILMORA database backups to UzCloud Object Storage (runs inside the `backup` service on ilmora-admin).
#
#   backup.sh --schedule          every day at BACKUP_AT_UTC (the service's entrypoint)
#   backup.sh --now               one backup right away
#   backup.sh --list              list the stored backups
#   backup.sh --restore <name>    download + decrypt + restore into "<db>_restore"; the live database is NOT touched
#
# Run the manual modes with: docker compose exec backup backup.sh --now
# Each dump: pg_dump (custom format) → integrity check → AES-256 (openssl, passphrase BACKUP_PASSPHRASE) → s3://BUCKET/db/
set -eu

PREFIX="s3://${S3_BUCKET}/db"
WORK=/tmp/ilmora-backup
# UzCloud speaks the S3 protocol with path-style addresses; newer aws-cli checksums are not needed there.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
aws configure set default.s3.addressing_style path
s3() { aws --endpoint-url "$S3_ENDPOINT" s3 "$@"; }

backup_once() {
  mkdir -p "$WORK"
  stamp=$(date -u +%Y%m%d-%H%M%S)
  dump="$WORK/ilmora-$stamp.dump"
  pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$dump"
  pg_restore --list "$dump" > /dev/null
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$dump" -out "$dump.enc"
  s3 cp --only-show-errors "$dump.enc" "$PREFIX/ilmora-$stamp.dump.enc"
  echo "backup stored: $PREFIX/ilmora-$stamp.dump.enc ($(du -h "$dump.enc" | cut -f1))"
  rm -f "$dump" "$dump.enc"

  cutoff=$(date -u -d "@$(( $(date -u +%s) - ${BACKUP_RETENTION_DAYS:-90} * 86400 ))" +%Y-%m-%d)
  s3 ls "$PREFIX/" | while read -r day _time _size name; do
    if [ -n "$name" ] && [ "$day" \< "$cutoff" ]; then s3 rm --only-show-errors "$PREFIX/$name" && echo "expired: $name"; fi
  done

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
      backup_once || echo "BACKUP FAILED $(date -u '+%Y-%m-%d %H:%M') UTC"
    done
    ;;
  --now)
    backup_once
    ;;
  --list)
    s3 ls "$PREFIX/"
    ;;
  --restore)
    name="${2:?usage: backup.sh --restore <ilmora-YYYYmmdd-HHMMSS.dump.enc>}"
    target="${PGDATABASE}_restore"
    mkdir -p "$WORK"
    s3 cp --only-show-errors "$PREFIX/$name" "$WORK/restore.enc"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$WORK/restore.enc" -out "$WORK/restore.dump"
    psql -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$target\";" -c "CREATE DATABASE \"$target\";"
    pg_restore --no-owner --no-privileges -d "$target" "$WORK/restore.dump"
    rm -f "$WORK/restore.enc" "$WORK/restore.dump"
    echo "restored into database \"$target\". The live database \"$PGDATABASE\" is unchanged."
    echo "Swapping it in is a separate, deliberate step: infra/uzcloud/README.md, section «Восстановление»."
    ;;
  *)
    echo "usage: backup.sh --schedule | --now | --list | --restore <name>" >&2
    exit 2
    ;;
esac
