#!/bin/sh
# Roll out the images named in the machine's .env.
#   sh infra/uzcloud/deploy.sh admin     on ilmora-admin: data services → migrations (+ seed on the first release)
#                                        → worker + admin panel + backups
#                                        IMPORT_ONLINE_COURSES=true (the release's «import_online_courses» input) also
#                                        imports the curated online course catalog right after the migrations
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

# The release copies the new Caddyfile to web/caddy.next/, not to web/caddy/ — the folder the running Caddy reads. Here
# it is validated in a throwaway container (the real values from web/.env) and only then moved into caddy/, so a broken
# file never reaches the folder Caddy starts from: a later restart of Caddy or of the machine still gets the last good
# one (security review 11.11, №88). A rejected file is kept in caddy.rejected/ to look at. Run by hand without a new
# copy (README «Откат»), the file already in caddy/ is checked. An empty ADMIN_ALLOW_IPS passes `caddy validate` but
# answers 403 to every address on the admin domain, so it stops the release too.
install_caddyfile() {
  dir=caddy
  [ -f caddy.next/Caddyfile ] && dir=caddy.next
  echo "== caddy validate ($dir/Caddyfile)"
  out=$($COMPOSE run --rm --no-deps -T -v "$PWD/$dir:/etc/caddy.check:ro" caddy \
    caddy validate --config /etc/caddy.check/Caddyfile 2>&1) || {
    echo "$out" | grep -v ' Container ' | tail -n 3
    if [ "$dir" = caddy.next ]; then
      rm -rf caddy.rejected && mv caddy.next caddy.rejected
      echo "the new Caddyfile is invalid (moved to web/caddy.rejected/): release stopped, Caddy keeps the current one"
    else
      echo "web/caddy/Caddyfile is invalid: stopped"
    fi
    exit 1
  }
  allow=$(sed -n 's/^ADMIN_ALLOW_IPS=//p' .env | tr -d "\"' ")
  if [ -z "$allow" ]; then
    echo "ADMIN_ALLOW_IPS is empty in web/.env: the admin domain would answer 403 to everyone (\"0.0.0.0/0 ::/0\" = open)"
    exit 1
  fi
  if [ "$dir" = caddy.next ]; then
    mkdir -p caddy
    # Same folder, then rename: Caddy never sees a half-written file.
    cp caddy.next/Caddyfile caddy/Caddyfile.new && mv caddy/Caddyfile.new caddy/Caddyfile
    rm -rf caddy.next
  fi
  echo "Caddyfile: valid configuration, in place"
}

# Re-reads the Caddyfile in place (caddy/ is mounted as a folder, №24). A Caddy that has just been (re)created by
# `up -d` may need a few seconds before it accepts a reload. A failed reload stops the release: it used to be hidden
# by `|| echo skipped`, and the site silently kept the previous configuration (security review 11.11, №125).
reload_caddy() {
  for attempt in 1 2 3 4 5; do
    $COMPOSE exec -T caddy caddy reload --config /etc/caddy/Caddyfile && return 0
    [ "$attempt" = 5 ] && break
    sleep 3
  done
  echo "caddy reload failed: Caddy keeps its previous configuration; see: $COMPOSE logs --tail=50 caddy"
  exit 1
}

# redis.conf is read only when Redis starts. The folder is mounted (a file mount kept the old file even after a
# restart — security review 11.11, №123), and Redis is recreated when the file differs from the one it started with.
# .redis-conf.sha256 remembers that; it is not in git, so the first run after this change recreates Redis once.
apply_redis_conf() {
  want=$(sha256sum ../../redis/redis.conf | cut -d' ' -f1)
  have=$(cat .redis-conf.sha256 2>/dev/null || true)
  if [ "$want" != "$have" ]; then
    echo "== redis.conf changed: recreating redis"
    $COMPOSE up -d --force-recreate redis
  else
    $COMPOSE up -d redis
  fi
  wait_healthy redis
  echo "$want" > .redis-conf.sha256
}

case "$ROLE" in
  admin)
    check_disk
    pull_images --profile migrate
    $COMPOSE up -d postgres
    apply_redis_conf
    wait_healthy postgres
    # The live database is dumped before the schema moves (restore path: admin/backup.sh --restore). Without a backup
    # the release stops before the migrations — it used to go on silently (security review 11.11, №125). NO_BACKUP=true
    # (the release's «no_backup» input) is for the first install, before backups are set up, and for emergencies.
    if backup_configured; then
      echo "== backup before migrations"
      # --entrypoint: the service's own entrypoint is `backup.sh --schedule`; a plain `run backup backup.sh --now` only
      # appends to it, so the script slept until the nightly time and the release hung (9 Nov 2026, run 44).
      $COMPOSE run --rm --no-deps --build --entrypoint /usr/local/bin/backup.sh backup --now
    elif [ "${NO_BACKUP:-}" = true ]; then
      echo "== NO_BACKUP=true: migrations WITHOUT a backup (BACKUP_PASSPHRASE is not set in admin/.env)"
    else
      echo "BACKUP_PASSPHRASE is not set in admin/.env: no backup can be taken before the migrations, release stopped."
      echo "Set up backups (README, first install, steps 6–7), or release with «no_backup» (first install, emergency)."
      exit 1
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
    # The curated online courses (packages/shared/src/online-courses.ts) reach the database only on request, never on
    # an ordinary release. The script is safe to repeat: it adds the missing courses and categories, refreshes the
    # provider facts of the ones already there and leaves their status, visibility and every other record alone
    # (apps/api/prisma/seed-online-courses.ts). It runs after the backup step above.
    if [ "${IMPORT_ONLINE_COURSES:-}" = true ]; then
      echo "== online course catalog import"
      $COMPOSE --profile migrate run --rm migrate npx tsx prisma/seed-online-courses.ts
    fi
    if backup_configured; then
      $COMPOSE up -d --build worker admin backup
    else
      # Without the passphrase the service could not encrypt a dump anyway: its image is not built and it stays off.
      echo "== BACKUP_PASSPHRASE is not set in admin/.env: backup service not started (set up admin/backup.sh)"
      $COMPOSE up -d worker admin
    fi
    wait_healthy admin
    # The worker has no page to check from outside: a provider missing from its root killed it on start for 14 hours
    # after release 51 while every check stayed green (11.11). Its healthcheck sees the process; wait for it here.
    wait_healthy worker
    ;;
  web)
    check_disk
    pull_images
    install_caddyfile
    $COMPOSE up -d
    reload_caddy
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
