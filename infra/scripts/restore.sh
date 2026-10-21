#!/bin/sh
# Restore a logical backup into the running postgres container.
#   infra/scripts/restore.sh infra/backups/ilmora-20261018-010000.dump
# Stops api/worker first (no writes during restore), restores into a fresh database, then swaps names.
set -eu
DUMP=${1:?usage: restore.sh <dump file>}
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"
. ./infra/.env.prod
$COMPOSE stop api worker
docker cp "$DUMP" ilmora-postgres-1:/tmp/restore.dump
$COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS ${POSTGRES_DB}_restore;" -c "CREATE DATABASE ${POSTGRES_DB}_restore OWNER $POSTGRES_USER;"
$COMPOSE exec -T postgres pg_restore -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restore" --no-owner --no-privileges /tmp/restore.dump
$COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${POSTGRES_DB}';" \
  -c "ALTER DATABASE ${POSTGRES_DB} RENAME TO ${POSTGRES_DB}_old_$(date +%s);" \
  -c "ALTER DATABASE ${POSTGRES_DB}_restore RENAME TO ${POSTGRES_DB};"
$COMPOSE start api worker
echo "restore complete; the previous database was kept under a *_old_<timestamp> name. Drop it after verification."
