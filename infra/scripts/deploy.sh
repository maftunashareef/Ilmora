#!/bin/sh
# Roll out the images referenced in infra/.env.prod: pull → migrate (one-shot) → start app containers → smoke check.
# Rollback: edit infra/.env.prod back to the previous digests and re-run this script (see docs/deployment.md §Rollback).
set -eu
cd "$(dirname "$0")/../.."
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod"
. ./infra/.env.prod

echo "== pulling images"
$COMPOSE pull postgres redis migrate api worker web nginx
echo "== starting data services"
$COMPOSE up -d postgres redis
echo "== running migrations (serialized, backward compatible with the running release)"
$COMPOSE run --rm migrate
echo "== rolling application containers"
$COMPOSE up -d --no-deps api worker web nginx backup
echo "== readiness"
for i in $(seq 1 30); do
  if $COMPOSE exec -T api wget -qO- http://127.0.0.1:4000/health/ready >/dev/null 2>&1; then echo "api ready"; break; fi
  sleep 3
  [ "$i" = 30 ] && { echo "api did not become ready"; $COMPOSE logs --tail=100 api; exit 1; }
done
echo "== smoke"
curl -fsS "https://${API_DOMAIN}/health/ready" && echo
curl -fsS -o /dev/null -w "web %{http_code}\n" "https://${WEB_DOMAIN}/"
curl -fsS -o /dev/null -w "catalog %{http_code}\n" "https://${API_DOMAIN}/v1/public/catalog"
echo "== done"
