#!/bin/sh
# docker compose for one machine with both settings files (shared api.env, then the machine's .env).
#   sh /opt/ilmora/infra/uzcloud/compose.sh admin ps
#   sh /opt/ilmora/infra/uzcloud/compose.sh admin exec backup backup.sh --now
#   sh /opt/ilmora/infra/uzcloud/compose.sh web logs --tail=100 api
set -eu
ROLE=${1:?usage: compose.sh admin|web <docker compose arguments>}
shift
cd "$(dirname "$0")/$ROLE"
exec docker compose --env-file ../api.env --env-file .env "$@"
