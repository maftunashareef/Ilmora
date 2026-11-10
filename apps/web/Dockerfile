# syntax=docker/dockerfile:1.7
# ILMORA web (Next.js, standalone output). Non-root runtime with only the traced files.
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace packages/shared --workspace apps/web --include-workspace-root=false --no-audit --no-fund

FROM deps AS build
# Public build-time configuration (baked into the client bundle). Server-only values come from the environment at runtime.
ARG NEXT_PUBLIC_API_URL=https://api.ilmora.uz
ARG NEXT_PUBLIC_SITE_URL=https://ilmora.uz
# Public address of the media bucket: images may load from its host and the browser may upload there (security-headers.ts).
# Empty = no object storage allowed by the CSP.
ARG NEXT_PUBLIC_MEDIA_BASE_URL=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_MEDIA_BASE_URL=${NEXT_PUBLIC_MEDIA_BASE_URL} \
    NEXT_TELEMETRY_DISABLED=1
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w packages/shared && npm run build -w apps/web

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apk add --no-cache tini wget
# standalone output keeps the monorepo layout: /app/apps/web/server.js
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
