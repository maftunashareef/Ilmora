# syntax=docker/dockerfile:1.7
# ILMORA API — multi-stage build. Targets:
#   api      : production runtime (API or worker, selected by APP_ROLE / command), non-root, prod deps only
#   migrator : same code with the Prisma CLI, used only to run `prisma migrate deploy` before a rollout
# Size is measured with `docker image inspect --format '{{.Size}}'` (uncompressed).

ARG NODE_IMAGE=node:24-alpine

# ---------- deps: full install for building ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# Install only the workspaces the API needs (shared + api); native modules (argon2) use prebuilt binaries.
RUN npm ci --workspace packages/shared --workspace apps/api --include-workspace-root=false --no-audit --no-fund

# ---------- build ----------
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w packages/shared \
 && cd apps/api && npx prisma generate && npx nest build

# ---------- prod-deps: pruned production node_modules ----------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace packages/shared --workspace apps/api --include-workspace-root=false --omit=dev --no-audit --no-fund \
 && npm cache clean --force \
 && mkdir -p apps/api/node_modules packages/shared/node_modules

# ---------- migrator: Prisma CLI + migrations ----------
FROM build AS migrator
WORKDIR /repo/apps/api
ENV NODE_ENV=production
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------- api: runtime ----------
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production \
    PORT=4000 \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /repo
RUN apk add --no-cache tini wget
COPY --from=prod-deps /repo/node_modules ./node_modules
# npm keeps a package under the workspace's own node_modules when the root already holds another version of it (the
# lockfile decides); those directories are part of the runtime too. Missing them crashed the worker on 2026-11-22
# ("Cannot find module '@sentry/nestjs'": every @sentry/* package sits in apps/api/node_modules since Sentry 11.12).
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps /repo/package.json ./package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
WORKDIR /repo/apps/api
# Every runtime dependency of the API must resolve from the pruned node_modules, otherwise the build fails here instead
# of the container crashing at startup during a rollout.
RUN node -e "const d=Object.keys(require('./package.json').dependencies||{});const miss=d.filter(m=>{try{require.resolve(m)}catch(e){return e.code==='MODULE_NOT_FOUND'}});if(miss.length){console.error('missing in the image:',miss.join(' '));process.exit(1)}console.log(d.length+' runtime dependencies resolve')"
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:4000/health/live || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
