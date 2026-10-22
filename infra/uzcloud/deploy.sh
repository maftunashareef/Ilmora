#!/bin/sh
# Roll out the images named in the machine's .env.
#   sh infra/uzcloud/deploy.sh admin     on ilmora-admin: data services → migrations → worker + admin panel + backups
#   sh infra/uzcloud/deploy.sh web       on ilmora-web:   api + site + Caddy, then checks from outside
# Order on release: admin first (migrations are backward compatible with the running api), then web.
# Rollback: put the previous image lines back into .env (deploy keeps .env.previous) and run the same command.
set -eu
ROLE=${1:?usage: deploy.sh admin|web}
cd "$(dirname "$0")/$ROLE"
[ -f .env ] && [ -f ../api.env ] || { echo "missing $ROLE/.env or api.env (see the .example files)"; exit 1; }
COMPOSE="docker compose --env-file .env"

wait_healthy() {
  for i in $(seq 1 40); do
    state=$($COMPOSE ps --format '{{.Health}}' "$1" 2>/dev/null || true)
    [ "$state" = healthy ] && { echo "$1 healthy"; return 0; }
    sleep 3
  done
  echo "$1 did not become healthy"; $COMPOSE logs --tail=80 "$1"; return 1
}

case "$ROLE" in
  admin)
    $COMPOSE --profile migrate pull --quiet --ignore-buildable
    $COMPOSE up -d postgres redis
    wait_healthy postgres
    echo "== migrations"
    $COMPOSE --profile migrate run --rm migrate
    $COMPOSE up -d --build worker admin backup
    wait_healthy admin
    ;;
  web)
    $COMPOSE pull --quiet
    $COMPOSE up -d
    wait_healthy api
    wait_healthy web
    . ./.env
    echo "== checks from outside"
    curl -fsS "https://${WEB_DOMAIN}/health/ready" && echo
    curl -fsS -o /dev/null -w "site %{http_code}\n" "https://${WEB_DOMAIN}/uz"
    curl -fsS -o /dev/null -w "catalog %{http_code}\n" "https://${WEB_DOMAIN}/v1/public/catalog"
    ;;
  *)
    echo "usage: deploy.sh admin|web"; exit 2
    ;;
esac
docker image prune -f > /dev/null
echo "== $ROLE done"
