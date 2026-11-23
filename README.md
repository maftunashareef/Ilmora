# ILMORA

One monthly subscription across education centers in Tashkent: students pick a Duo (2 courses) or Trio (3 courses) package, join specific groups without schedule conflicts, pay once, and check in to every lesson with a per-session QR code. Three workspaces: Super Admin (site template, catalog, people, finance), Teacher Studio (courses, groups, content, attendance) and the Student workspace.

> The repository started as a React/Vite prototype with all state in `localStorage`. It is now a production architecture: **Next.js 16** web app, **NestJS 12** API, **Prisma 7 / PostgreSQL**, **Redis + BullMQ**, the Payme adapter, Docker deployment on UzCloud (Caddy) and GitHub Actions CI/CD. The sample catalog (fictional centers, teachers, courses) is kept as seed data.

## Repository layout

```
apps/web        Next.js app (App Router, locale routes /uz /ru /en, SEO, dashboards)
apps/api        NestJS API + worker (Prisma schema, migrations, seed, tests)
packages/shared Domain types, pure rules (access, schedule, capacity, sessions, check-in), UZ/RU/EN dictionary, sample data
infra/          uzcloud/ (two-machine Docker Compose, Caddy, nightly backups, release scripts, runbook), redis/redis.conf
docs/           deployment notes, payment protocol references and onboarding, legal notes
.github/        CI (typecheck, lint, tests with Postgres/Redis services, builds, migration drift check) and the release workflow
```

## Local development

Requirements: Node 24, PostgreSQL 16+ (any host), optionally Redis 7. Windows and macOS/Linux both work.

```bash
npm install
npm run build:shared                       # builds @ilmora/shared (dist used by both apps)
cp apps/api/.env.example apps/api/.env     # set DATABASE_URL; for a laptop without Redis set REDIS_MODE=off
npm run db:migrate                         # prisma migrate deploy
npm run db:seed                            # tenant, site template, packages, catalog (+ demo users outside production)
npm run dev                                # shared (watch) + api :4000 + web :3000
```

Web: http://localhost:3000 (redirects to `/uz`). API: http://localhost:4000/v1, health at `/health/ready`.

Sign-in is login + password. Registration offers two roles only, Student and Teacher; a new Teacher gets an empty public profile (no center until an admin assigns one) and lands in the Teacher Studio, a Student lands in the Student workspace. The phone + one-time-code endpoints remain in the API (`/v1/auth/otp/*`) for phone verification but the login screen no longer uses them.

**Super Admin** is held by the tenant's *owner* accounts (one or more, `User.isOwner`) and is never offered at registration, never granted through the API, and never assigned to "the first user". Designate owners on the server (the password is typed into a hidden prompt, not passed as an argument):

```bash
npm run owner:setup -- --login <your-login>          # local / staging checkout
sh /opt/ilmora/infra/uzcloud/compose.sh admin --profile migrate run --rm migrate node dist/cli/owner-setup.js --login <your-login>   # production, on ilmora-admin
```

The command first lists the owners and every account that carries privileged roles. When owners already exist it changes nothing unless told how: `--add` adds the login as another owner, `--replace` makes it the only owner (the others lose Super Admin and are signed out), `--remove` takes Super Admin away from a login (never from the last owner). Roles of non-owner accounts are stripped only with `--demote-others`. Admin claims are derived from the owner flag at every sign-in and refresh, so a roles column alone can never grant them.

The UzCloud deployment (two machines) is described in `infra/uzcloud/README.md`.

Demo accounts created by the seed (non-production only): students `aziz`, `jasur`, … (ids `s-*`), teachers `dilnoza`, `bekzod`, … (ids `t-*`). They get a password only when `SEED_DEMO_PASSWORD` is set for the seed run; there is no default password.

`REDIS_MODE=off` is a development convenience: rate limits become per-process, SMS is delivered inline, no background jobs or cross-replica live updates. It is refused in production.

## Tests and checks

```bash
npm run typecheck     # all workspaces
npm run lint          # oxlint
npm test              # shared unit tests + API tests (database-backed suites need TEST_DATABASE_URL)
```

API test suites (`apps/api/test`) cover: Payme create/perform/cancel with concurrent `PerformTransaction` calls settling exactly once, capacity races on the last seat, tenant isolation of the Prisma extension, refresh-token rotation with reuse detection, attendance tokens/enrollment/open-window/idempotency rules, concurrent QR scans, and exclusive daily job runs.

## Key behaviours

* **Tenant isolation** — every tenant-scoped Prisma query is filtered by the request's tenant through a client extension (fails closed without a context); provider callbacks resolve the tenant from the payment they reference.
* **Authentication** — phone + OTP (argon2-hashed, attempt-limited, per-phone window), 15-minute JWT access tokens, rotating refresh sessions stored as hashes in an HTTP-only `SameSite=Lax` cookie scoped to `/v1/auth`; reuse of a rotated token revokes the family; CSRF defence through the `X-Requested-With` header + Origin allow-list.
* **Enrollment** — the builder enforces package limits, duplicates, schedule conflicts and capacity client-side for immediate feedback; the API re-validates and, at checkout, holds seats (`PENDING` enrollments) inside a row-locked transaction, so the last seat cannot be sold twice. Holds expire with the payment (24 h).
* **Payments** — the Payme JSON-RPC and Click SHOP API adapters implement the official protocols (`docs/payments/`) and settle through one row-locked path that activates the subscription, posts a balanced ledger journal and writes an outbox event for the receipt. Repeated/concurrent callbacks are idempotent. One invoice takes one payment at a time: while a Payme or Click attempt runs, the other is refused. Reconciliation (finance admin) shows provider vs. payment vs. ledger state and flags money taken that bought nothing (`refund_required`, `double_payment`); neither provider is queried independently (Payme calls our `GetStatement`, Click's Merchant API is not connected).
* **Lessons & attendance** — sessions are materialised daily (00:30 Asia/Tashkent, idempotent, never marks anyone present). Teachers open attendance → a per-session token (hashed at rest, rotated on each QR view, void on close) is encoded in the QR URL `/attend/<sessionId>?t=…`. The student's phone opens ILMORA, signs in if needed, and the page performs an authenticated `POST /v1/attendance/check-in`; duplicates return the original record. Teachers see check-ins live (SSE over Redis pub/sub) and can correct records with a mandatory reason; everything is audited. Scanning proves the account, not physical presence.
* **Content access** — courses, videos, playlists and resources carry status/visibility/audience; the server enforces the same rule the UI shows.
* **Localisation & SEO** — `/uz`, `/ru`, `/en` routes with hreflang alternates, canonical URLs, Open Graph, sitemap, robots (private areas disallowed), JSON-LD (Course, Person, Organization — factual data only). Private dashboards are `noindex`.

## Deployment

Production runs on UzCloud in Tashkent, on two machines: `ilmora-web` (Caddy, site, API) and `ilmora-admin` (admin panel, worker, PostgreSQL, Redis, nightly encrypted backups to UzCloud Object Storage). Installation, secrets, release, owners, backups and restore, rollback and team access are in `infra/uzcloud/README.md` (in Russian); topology, the availability statement, the migration convention and an operations reference are in `docs/deployment.md`; Payme and Click onboarding is in `docs/payments/onboarding-checklist.md`. CI builds the images from `apps/api/Dockerfile` and `apps/web/Dockerfile`; a release is started by hand with Actions → «Release (UzCloud)».

## Legal and data-residency notes

`docs/compliance/uz-personal-data-localization.md` summarises the Uzbek personal-data rules that affect hosting (as read on lex.uz on 2026-10-18) and lists the questions a lawyer must confirm. The document is not legal advice and the repository makes no compliance claim.

## Brand assets

`apps/web/public/brand/` holds the official logo (`ilmora-logo.png`, untouched), a trimmed variant, the Open Graph image (the logo on its own cream background) and icons cropped from the monogram. None of them were redrawn.
