#!/usr/bin/env bash
# Start command for the Render web service (see render.yaml): migrate, seed on demand, designate the owner on demand, serve.
set -euo pipefail

echo "[start] applying migrations"
npm run db:migrate --silent

if [ "${SEED_ON_DEPLOY:-false}" = "true" ]; then
  echo "[start] seeding (SEED_ON_DEPLOY=true; set it to false after the first deploy)"
  npm run db:seed --silent
fi

# One-time Super Admin designation from environment variables (set them in the Render dashboard, redeploy, then remove them).
if [ -n "${OWNER_LOGIN:-}" ] && [ -n "${OWNER_PASSWORD:-}" ]; then
  echo "[start] designating the owner account ${OWNER_LOGIN}"
  printf '%s' "${OWNER_PASSWORD}" | node apps/api/dist/cli/owner-setup.js --login "${OWNER_LOGIN}" --password-stdin --replace
fi

# One-off removal of test accounts (CLEANUP_LOGINS=a,b); idempotent, see cli/cleanup-accounts.ts.
if [ -n "${CLEANUP_LOGINS:-}" ]; then
  node apps/api/dist/cli/cleanup-accounts.js
fi

exec node apps/api/dist/main.js
