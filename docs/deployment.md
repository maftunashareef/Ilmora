# ILMORA — deployment notes (UzCloud, Tashkent)

Production runs on two UzCloud machines. The step-by-step runbook — installation, secrets, release, owners, backups
and restore, rollback, team access — is `infra/uzcloud/README.md` (in Russian). This page keeps what the runbook does
not: the topology at a glance, the availability statement, the migration convention and an operations reference.

## 1. Topology

```
Internet ──> ilmora-web (public IP)
               caddy  (80/443, TLS for ilmoraa.uz and admin.ilmoraa.uz)
               ├── web  (Next.js, APP_SURFACE=public, :3000)
               └── api  (NestJS, :4000) ─────────────┐
                                                     │  private network ilmora-prod
             ilmora-admin (private IP only)          │
               ├── admin    (the same web image, APP_SURFACE=admin; Caddy proxies admin.ilmoraa.uz to it)
               ├── worker   (NestJS queues)          │
               ├── postgres, redis  <────────────────┘  (published on the private address only)
               └── backup   (nightly encrypted pg_dump → UzCloud Object Storage, Cold bucket, 90 days)
```

Only Caddy on ilmora-web publishes ports to the internet. The admin API (`/v1/admin/*`) answers only on the admin
domain; Payme and Click call `/payments/*` on the public domain, outside the `/v1` prefix.

### Availability statement

Each part runs **once, with restart policies**. Containers restart after a crash and both machines come back after a
reboot, but this is **not high availability**: losing ilmora-admin stops the database and with it the whole site;
losing ilmora-web stops the site and the API. If the database disk is lost, data written after the last nightly backup
is lost. Genuine HA would additionally need a second application host behind a load balancer, PostgreSQL replication
with automatic failover (or a managed database), Redis Sentinel and shared object storage for uploads. Those are
capacity and budget decisions for a later stage; the application is already stateless enough (sessions in
PostgreSQL/Redis, no local files) to run several `api`/`worker`/`web` replicas when that infrastructure exists.

## 2. Releases and migrations

Releases are started by hand: Actions → «Release (UzCloud)» (`.github/workflows/deploy.yml`). ilmora-admin goes
first (database migrations, worker, admin), then ilmora-web; each step waits for the health checks.

Migrations are **backward compatible by convention**: a release may add tables/columns/indexes and backfill, but must
not drop or rename what the previous release still reads; removals ship one release later. That keeps the previous
containers working while the new ones start, and makes rollback a plain image switch (runbook, «Откат»). Migrations
are not rolled back automatically: if one must be undone, restore the pre-release backup (runbook, «Восстановление»)
or write a forward migration that reverts the change.

## 3. Operations

| Task | How |
| --- | --- |
| State and logs | `sh /opt/ilmora/infra/uzcloud/compose.sh web ps`, `… web logs --tail=100 api`, `… admin logs --tail=100 worker` |
| Readiness | `curl https://ilmoraa.uz/health/ready` → `{"status":"ready","checks":{"database":"ok","redis":"ok"}}` |
| Backups | `sh /opt/ilmora/infra/uzcloud/compose.sh admin exec backup backup.sh --list` (runbook for `--now` and `--restore`) |
| Failed jobs | Super Admin → `GET /v1/admin/jobs` (counts + last 20 failures per queue), `POST /v1/admin/jobs/:queue/:id/retry` |
| Daily session job | runs 00:30 Asia/Tashkent; exclusive per date (`JobRun` row); never creates attendance |
| Payment expiry | every 10 min, releases seat holds of unpaid checkouts |

## 4. Image sizes

Measure with `docker image inspect <image> --format '{{.Size}}'` (uncompressed bytes). The Dockerfiles use
`node:24-alpine`, prune dev dependencies and copy only `dist/` + production `node_modules`.

## 5. Payme / Click

Contracts, keys, callback URLs and the sandbox: `docs/payments/onboarding-checklist.md`. Protocol references used by
the adapters: `docs/payments/payme-merchant-api.md`, `docs/payments/click-shop-api.md`.
