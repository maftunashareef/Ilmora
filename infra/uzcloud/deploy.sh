#!/bin/sh
# Roll out the images named in the machine's .env.
#   sh infra/uzcloud/deploy.sh admin     on ilmora-admin: data services → migrations (+ seed on the first release)
#                                        → worker + admin panel + backups
#   sh infra/uzcloud/deploy.sh web       on ilmora-web:   api + site + Caddy, then checks from outside
# Order on release: admin first (migrations are backward compatible with the running api), then web.
# Rollback: cp .env.previous .env (the release workflow keeps the previous image lines there) and run the same command;
# images stay on the machine for two weeks, so no registry login is needed (a failed pull falls back to them).
# Disk: dangling images older than two weeks and stale build cache are pruned before the pull; under 2 GiB free the
# rollout stops before pulling anything (README, «Диск»).
set -eu
ROLE=${1:?usage: deploy.sh admin|web}
cd "$(dirname "$0")/$ROLE"
[ -f .env ] && [ -f ../api.env ] || { echo "missing $ROLE/.env or api.env (see the .example files)"; exit 1; }
COMPOSE="docker compose --env-file ../api.env --env-file .env"
DOCKER_ROOT=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
# The backup passphrase lives in admin/.env (README, first install, step 7); api.env is checked too. An empty value
# counts as not set. (Checking only api.env skipped every pre-migration backup and would keep the backup service off.)
backup_configured() { grep -qsE '^BACKUP_PASSPHRASE=.+' .env ../api.env; }

# Releases are pulled by digest (untagged), so a plain prune would delete the previous one: keep two weeks for rollback.
# Runs before the pull and again when the script ends, also after a failure (it used to run only after a successful
# rollout, so a few failed releases could fill the disk).
prune_images() {
  docker image prune -f --filter "until=336h" > /dev/null 2>&1 || true
  docker builder prune -f --filter "until=168h" > /dev/null 2>&1 || true
}
trap prune_images EXIT

# A full disk breaks PostgreSQL and Redis before it breaks a release (2026-11-09: ilmora-admin ran out of space while
# the rollout built the backup image). The numbers go to the release log, and with less than 2 GiB free the rollout
# stops before pulling anything; infra/uzcloud/README.md («Диск») says how to free space.
check_disk() {
  prune_images
  echo "== disk on $(hostname): $DOCKER_ROOT"
  df -h "$DOCKER_ROOT" | tail -1
  docker system df 2>/dev/null || true
  avail_kb=$(df -Pk "$DOCKER_ROOT" | awk 'NR == 2 { print $4 }')
  if [ "${avail_kb:-0}" -lt 2097152 ]; then
    echo "only $(( ${avail_kb:-0} / 1024 )) MiB free under $DOCKER_ROOT: free at least 2 GiB before releasing (README, «Диск»)"
    exit 1
  fi
}

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

# The new Caddyfile is validated in a throwaway container — the file this release copied and the real values from
# web/.env — before the running Caddy sees it. A broken file stops the release here and the site keeps its current
# configuration; without this, the error would surface only when Caddy next starts, with the site down. An empty
# ADMIN_ALLOW_IPS passes `caddy validate` but answers 403 to every address on the admin domain, so it is checked too.
check_caddyfile() {
  echo "== caddy validate"
  out=$($COMPOSE run --rm --no-deps -T caddy caddy validate --config /etc/caddy/Caddyfile 2>&1) || {
    echo "$out" | grep -v ' Container ' | tail -n 3
    echo "the new Caddyfile is invalid: release stopped, the running Caddy is untouched"
    exit 1
  }
  echo "Caddyfile: valid configuration"
  allow=$(sed -n 's/^ADMIN_ALLOW_IPS=//p' .env | tr -d "\"' ")
  if [ -z "$allow" ]; then
    echo "ADMIN_ALLOW_IPS is empty in web/.env: the admin domain would answer 403 to everyone (\"0.0.0.0/0 ::/0\" = open)"
    exit 1
  fi
}

case "$ROLE" in
  admin)
    check_disk
    pull_images --profile migrate
    $COMPOSE up -d postgres redis
    wait_healthy postgres
    # The live database is dumped before the schema moves (restore path: admin/backup.sh --restore).
    if backup_configured; then
      echo "== backup before migrations"
      # --entrypoint: the service's own entrypoint is `backup.sh --schedule`; a plain `run backup backup.sh --now` only
      # appends to it, so the script slept until the nightly time and the release hung (9 Nov 2026, run 44).
      $COMPOSE run --rm --no-deps --build --entrypoint /usr/local/bin/backup.sh backup --now
    else
      echo "== BACKUP_PASSPHRASE is not set in admin/.env: no backup before migrations (set up admin/backup.sh)"
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
    if backup_configured; then
      $COMPOSE up -d --build worker admin backup
    else
      # Without the passphrase the service could not encrypt a dump anyway: its image is not built and it stays off.
      echo "== BACKUP_PASSPHRASE is not set in admin/.env: backup service not started (set up admin/backup.sh)"
      $COMPOSE up -d worker admin
    fi
    wait_healthy admin
    ;;
  web)
    check_disk
    pull_images
    check_caddyfile
    $COMPOSE up -d
    # caddy/ is mounted as a folder, so reload reads the Caddyfile this release copied (security review 10.11, №24).
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
echo "== $ROLE done"
