#!/bin/sh
# Nightly logical backup of the ILMORA database (runs inside the `backup` service).
# Output: /backups/ilmora-YYYYmmdd-HHMMSS.dump (pg_dump custom format, compressed) + sha256.
# Copy the newest dump off-host every day (object storage in Uzbekistan or a second server);
# an on-host backup does not survive the loss of the VPS.
set -eu
STAMP=$(date -u +%Y%m%d-%H%M%S)
OUT=/backups/ilmora-${STAMP}.dump
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$OUT"
sha256sum "$OUT" > "$OUT.sha256"
find /backups -name 'ilmora-*.dump' -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
find /backups -name 'ilmora-*.dump.sha256' -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
echo "backup written: $OUT ($(du -h "$OUT" | cut -f1))"
