#!/bin/sh
# Roll out the images named in the machine's .env.
#   sh infra/uzcloud/deploy.sh admin     on ilmora-admin: data services → migrations (+ seed on the first release)
#                                        → worker + admin panel + backups
#   sh infra/uzcloud/deploy.sh web       on ilmora-web:   api + site + Caddy, then checks from outside
# Order on release: admin first (migrations are backward compatible with the running api), then web.
# Rollback: cp .env.previous .env (the release workflow keeps the previous image lines there) and run the same command;
# images stay on the machine for two weeks, so no registry login is needed (a failed pull falls back to them).
set -eu
ROLE=${1:?usage: deploy.sh admin|web}
cd "$(dirname "$0")/$ROLE"
[ -f .env ] && [ -f ../api.env ] || { echo "missing $ROLE/.env or api.env (see the .example files)"; exit 1; }
COMPOSE="docker compose --env-file ../api.env --env-file .env"

wait_healthy() {
  for i in $(seq 1 40); do
    state=$($COMPOSE ps --format '{{.Health}}' "$1" 2>/dev/null || true)
    [ "$state" = healthy ] && { echo "$1 healthy"; return 0; }
    sleep 3
  done
  echo "$1 did not become healthy"; $COMPOSE logs --tail=80 "$1"; return 1
}

# Pulls this release's images before anything changes. The link from UzCloud to GitHub's download host
# (pkg-containers.githubusercontent.com) sometimes times out, so a failed pull is retried with growing waits (layers
# already downloaded are kept). If it still fails, images already on this machine (a rollback) are used; a release image
# (pinned by digest) that is still missing stops the rollout here, before migrations or restarts.
pull_images() {
  for attempt in 1 2 3 4 5; do
    $COMPOSE "$@" pull --quiet --ignore-buildable && return 0
    [ "$attempt" = 5 ] && break
    echo "image pull failed (attempt $attempt of 5), retrying in $((attempt * 20))s"
    sleep $((attempt * 20))
  done
  missing=""
  for image in $($COMPOSE "$@" config --images | grep '@sha256:'); do
    docker image inspect "$image" > /dev/null 2>&1 || missing="$missing $image"
  done
  [ -z "$missing" ] && { echo "pull failed; using the images already on this machine"; return 0; }
  echo "could not pull from the registry:$missing"; return 1
}

case "$ROLE" in
  admin)
    pull_images --profile migrate
    $COMPOSE up -d postgres redis
    wait_healthy postgres
    # The live database is dumped before the schema moves (restore path: admin/backup.sh --restore).
    if grep -q '^BACKUP_PASSPHRASE=' ../api.env; then
      echo "== backup before migrations"
      $COMPOSE run --rm --no-deps --build backup backup.sh --now
    else
      echo "== BACKUP_PASSPHRASE is not set in api.env: no backup before migrations (set up admin/backup.sh)"
    fi
    echo "== migrations"
    $COMPOSE --profile migrate run --rm migrate
    # Initial data only on the very first release (no tenant yet); later releases never re-seed over admins' edits.
    PG_USER=$(sed -n 's/^POSTGRES_USER=//p' ../api.env)
    PG_DB=$(sed -n 's/^POSTGRES_DB=//p' ../api.env)
    if [ "$($COMPOSE exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc 'SELECT count(*) FROM "Tenant"')" = 0 ]; then
      echo "== first release: initial data (seed; SEED_CATALOG from api.env)"
      $COMPOSE --profile migrate run --rm migrate npx tsx prisma/seed.ts
    fi
    $COMPOSE up -d --build worker admin backup
    wait_healthy admin
    ;;
  web)
    pull_images
    $COMPOSE up -d
    # The Caddyfile is mounted read-only and re-read only on reload; the release copies it fresh every time.
    $COMPOSE exec -T caddy caddy reload --config /etc/caddy/Caddyfile || echo "caddy reload skipped (container not up yet)"
    wait_healthy api
    wait_healthy web
    # Through the local Caddy with the real certificate (the public IP belongs to the network, so this machine may not
    # reach itself through it); the release workflow repeats these checks from outside.
    WEB_DOMAIN=$(sed -n 's/^WEB_DOMAIN=//p' .env)
    LOCAL="--resolve ${WEB_DOMAIN}:443:127.0.0.1"
    echo "== checks through Caddy (DNS for $WEB_DOMAIN must point at the network IP for the certificate)"
    for i in $(seq 1 20); do curl -fsS $LOCAL -o /dev/null "https://${WEB_DOMAIN}/health/ready" 2>/dev/null && break; sleep 3; done
    curl -fsS $LOCAL "https://${WEB_DOMAIN}/health/ready" && echo
    curl -fsS $LOCAL -o /dev/null -w "site %{http_code}\n" "https://${WEB_DOMAIN}/uz"
    curl -fsS $LOCAL -o /dev/null -w "catalog %{http_code}\n" "https://${WEB_DOMAIN}/v1/public/catalog"
    ;;
  *)
    echo "usage: deploy.sh admin|web"; exit 2
    ;;
esac
# Releases are pulled by digest (untagged), so a plain prune would delete the previous one: keep two weeks for rollback.
docker image prune -f --filter "until=336h" > /dev/null
echo "== $ROLE done"
