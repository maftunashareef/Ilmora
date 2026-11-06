# ILMORA — deployment runbook (single VPS, Tashkent)

This document describes how the production stack in `infra/` is operated. Nothing in the repository deploys by itself: the GitHub Actions workflows build images and run `infra/scripts/deploy.sh` over SSH only when the configured environments and secrets exist.

## 1. Topology

```
Internet ──> nginx (80/443, TLS, edge rate limits)
               ├── web   (Next.js, :3000)   ── server-side calls ──> api
               └── api   (NestJS, :4000)    ──> postgres (:5432, internal only)
                   worker (NestJS, queues)  ──> redis    (:6379, internal only, noeviction, AOF)
               backup (nightly pg_dump → volume)      certbot (renewals, profile "certs")
```

Only nginx publishes ports. `postgres` and `redis` are reachable only on the `internal` compose network; `api`/`worker` join both networks, `web` only the edge network.

### Availability statement

This is **one host with restart policies**. It restarts crashed containers and survives a reboot, but it is **not high availability**: a hardware failure, a full disk or a kernel upgrade takes the whole service down until the host is back, and data written after the last backup is lost if the disk is lost. Genuine HA would additionally need: a second application host behind a load balancer (or DNS failover), PostgreSQL streaming replication with automatic failover (e.g. Patroni) or a managed database, Redis Sentinel/cluster, off-host backups with tested restores, and shared object storage for uploads. Those are capacity and budget decisions for a later stage; the application is already stateless enough (sessions in PostgreSQL/Redis, no local files) to run with several `api`/`worker`/`web` replicas when that infrastructure exists.

## 2. Server preparation

1. Ubuntu 24.04 LTS, 4 vCPU / 8 GB RAM / 80 GB SSD or larger, located in Uzbekistan (see `docs/compliance/uz-personal-data-localization.md` for why residency matters).
2. Install Docker Engine + Compose plugin; create a deploy user in the `docker` group; disable password SSH login.
3. Firewall: allow 22 (restricted to admin IPs), 80, 443; everything else closed. Never publish 5432/6379.
4. DNS: `A` records for `ilmora.uz`, `www.ilmora.uz`, `api.ilmora.uz` → server IP.
5. Clone the repository into `/srv/ilmora` (the deploy workflow does `git checkout <sha>` there).
6. `cp infra/.env.prod.example infra/.env.prod` and fill every value; generate secrets with
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.

## 3. First issuance of TLS certificates

nginx expects certificates before it starts the HTTPS servers. Issue them once with the webroot method:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d nginx   # fails on 443 until certs exist; HTTP :80 serves the ACME path
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod run --rm \
  --profile certs certbot certonly --webroot -w /var/www/certbot \
  -d ilmora.uz -d www.ilmora.uz -d api.ilmora.uz --email admin@ilmora.uz --agree-tos --no-eff-email
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod restart nginx
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod --profile certs up -d certbot   # renew loop (every 12 h)
```

If `nginx` refuses to start before the certificates exist, temporarily comment out the two `listen 443` server blocks in `infra/nginx/conf.d/ilmora.conf.template`, issue the certificates, and restore the file.

## 4. Deploying a release

CI (`.github/workflows/deploy.yml`) builds three images per commit on `main`, tags them with the commit SHA and records their digests; staging deploys automatically, production waits for an approval in the GitHub environment `production`. On the server the same script runs in both cases:

```bash
sh infra/scripts/deploy.sh
```

It pulls images, starts `postgres`/`redis`, runs the one-shot `migrate` container (`prisma migrate deploy`, serialized by compose), then rolls `api`, `worker`, `web`, `nginx`, and finally checks `/health/ready`, the web root and the public catalog.

After the first deploy, designate the Super Admin owner (hidden password prompt; nothing sensitive on the command line); add a second owner the same way with `--add`:

```bash
docker compose -f infra/docker-compose.prod.yml exec api node dist/cli/owner-setup.js --login <your-login>
```

The command lists owners and accounts with privileged roles before changing anything. With owners in place it needs `--add` (another owner), `--replace` (the only owner) or `--remove` (never the last owner), and strips roles from other accounts only with `--demote-others`. Only owner accounts receive Super Admin claims; registration offers Student and Teacher only.

Migrations are **backward compatible by convention**: a release may add tables/columns/indexes and backfill, but must not drop or rename what the previous release still reads; removals ship one release later. That keeps the previous containers working while the new ones start, and makes rollback a plain image switch.

## 5. Rollback

1. `cp infra/.env.prod.previous infra/.env.prod` (the production job keeps the previous digests) — or edit the three `*_IMAGE=` lines by hand.
2. `sh infra/scripts/deploy.sh`.
3. Database: migrations are not rolled back automatically. Because they are additive, the previous application runs against the newer schema. If a migration must be undone, restore the pre-release backup (§6) or write a forward migration that reverts the change.

## 6. Backups and restore

* The `backup` service writes `pg_dump --format=custom` files to the `backups` volume every 24 h and prunes them after `BACKUP_RETENTION_DAYS` (default 14). A checksum file accompanies each dump.
* Copy the newest dump off the host daily (object storage located in Uzbekistan, or a second server) — an on-host backup does not survive losing the VPS. Example cron on the host:
  `0 3 * * * docker cp ilmora-backup-1:/backups/$(docker exec ilmora-backup-1 sh -c 'ls -t /backups | head -1') /srv/offsite/`
* Restore: `sh infra/scripts/restore.sh infra/backups/ilmora-YYYYmmdd-HHMMSS.dump` (stops api/worker, restores into a fresh database, swaps names, restarts). Test a restore on staging at least monthly.
* Redis: AOF persistence is enabled; queue state is recoverable after a restart. Losing Redis entirely loses pending jobs, which is why every durable side effect (receipts, notifications) goes through the PostgreSQL outbox and is re-dispatched.

## 7. Operations

| Task | How |
| --- | --- |
| Logs | `docker compose -f infra/docker-compose.prod.yml logs -f api worker web nginx` (json-file, rotated 5×20 MB) |
| Readiness | `curl https://api.ilmora.uz/health/ready` → `{"status":"ready","checks":{"database":"ok","redis":"ok"}}` |
| Failed jobs | Super Admin → `GET /v1/admin/jobs` (counts + last 20 failures per queue), `POST /v1/admin/jobs/:queue/:id/retry` |
| Daily session job | runs 00:30 Asia/Tashkent; exclusive per date (`JobRun` row); never creates attendance |
| Payment expiry | every 10 min, releases seat holds of unpaid checkouts |
| Scale | `docker compose ... up -d --scale api=2 --scale worker=2` works (shared rate limits via Redis, pub/sub for SSE, idempotent jobs); nginx upstream must then point at the service name, which Docker DNS round-robins |

## 8. Image sizes

Measure with `docker image inspect <image> --format '{{.Size}}'` (uncompressed bytes). The Dockerfiles use `node:24-alpine`, prune dev dependencies and copy only `dist/` + production `node_modules`. Actual sizes must be recorded here after the first CI build; they were **not measured** in the development environment used to write this repository (no Docker daemon was available).

## 9. Provider configuration (Payme / Click)

* Payme Business: create a web cash register, set the Endpoint URL to `https://ilmoraa.uz/payments/payme` (the public host; Caddy passes `/payments/*` to the API outside the `/v1` prefix), copy the merchant id and the production key into `PAYME_MERCHANT_ID` / `PAYME_KEY`. Use `PAYME_TEST_KEY` only on staging (`NODE_ENV!=production`). Restrict source IPs with `PAYME_ALLOWED_IPS` (the documented 185.234.113.1–15).
* Click: register the service, set Prepare URL `https://ilmoraa.uz/payments/click/prepare` and Complete URL `https://ilmoraa.uz/payments/click/complete`, fill `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_MERCHANT_USER_ID`, `CLICK_SECRET_KEY`.
* Until these are set the checkout screen shows both providers as "not connected"; nothing can be charged.

Protocol references used by the adapters: `docs/payments/payme-merchant-api.md`, `docs/payments/click-shop-api.md`.
