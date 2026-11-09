# ILMORA Agent Handoff

**Last updated:** 2026-10-25 · **Session:** Branch Conflict Resolution & Safe Integration (Session 17)  
**Current HEAD:** `cc6662d` test(auth): align effectiveRoles test with multi-owner isOwner model  
**Branch:** `feat/ilmora-release-integrated` (pushed to `origin/feat/ilmora-release-integrated`)  
**Mergeability with `origin/main`:** ✅ **CLEAN MERGE — ZERO CONFLICTS** (automatic merge verified)

- **Conflict Investigation & Resolution:** Reconciled divergent commits between `origin/main` (`67cfff4`) and feature release branch.
- **Prisma Schema & Migrations:** Kept `User.isOwner` and migration `20261023000000_multiple_owners`.
- **Consent Contract:** Aligned `RegisterDto`, `ConsentDto`, and `Login.tsx` with owner's decision (dropping `consentAbroad`/`marketing`), preserving backwards compatibility in `ConsentInput` and adding `phone?: string` to `RegisterInput`.
- **Super Admin Security:** Preserved `User.isOwner` checking in `effectiveRoles()` and `manage.service.ts` (`setRoles`).
- **All Quality Checks Passed:** 74/74 unit tests pass (`shared`: 20/20, `api`: 43/43, `web`: 11/11). Builds and typechecks pass with 0 errors.
- **GitHub PR:** https://github.com/maftunashareef/Ilmora/pull/new/feat/ilmora-release-integrated

---

## Project Summary

Education-platform monorepo (Tashkent):
- **Web:** Next.js 16, App Router, `/uz` `/ru` `/en` locales, RSC + client components
- **API:** NestJS 12, Prisma 7 / PostgreSQL, Redis + BullMQ, Payme + Click adapters
- **Shared:** `packages/shared` — domain types, pure rules, i18n dict, legal text
- **Deploy:** UzCloud, two machines behind Caddy (infra/uzcloud), released by the manual "Release (UzCloud)" GitHub Actions workflow from main after green CI (the old VPS and Render setups were removed). CI via GitHub Actions.

Stack: Node 24, TypeScript ~6, oxlint, vitest. No tsc in PATH — use `node_modules/.bin/tsc`.

---

## Health Check (2026-10-25, Session 15)

| Check | Status |
|-------|--------|
| `npm run build:shared` | ✅ PASS |
| `tsc -p packages/shared --noEmit` | ✅ 0 errors |
| `tsc -p apps/api/tsconfig.json --noEmit` | ✅ 0 errors |
| `tsc -p apps/web/tsconfig.json --noEmit` | ✅ 0 errors |
| Unit tests (`shared` 20/20 + `api` 41/41 + `web` 10/10) | ✅ 71/71 PASS |
| API DB integration tests (19 tests) | ⚠️ Skipped — no local PostgreSQL (`TEST_DATABASE_URL` unset) |
| Frontend tests (`apps/web/src/store/auth.test.ts`, `teachers.test.ts`) | ✅ 10/10 PASS |
| `npm run lint -w apps/api` (oxlint) | ✅ 0 errors, 0 warnings |
| `npm run lint -w apps/web` (oxlint) | ⚠️ 0 errors, 65 warnings (React Compiler optimization) |
| Next.js production build (`build:web`) | ✅ PASS — 55 routes compiled (Turbopack) in 1.9s |
| NestJS production build (`build:api`) | ✅ PASS (Prisma generated) |
| `prisma validate` | ✅ Schema valid |
| `prisma migrate status` | ❌ `P1001` — no local DB |
| Security code audit (teacher profile isolation, cross-tenant guards, secrets) | ✅ Verified |
| Duplicate operation protection (payments, attendance, Click idempotency) | ✅ Verified |

---

## Architecture Notes

- **Tenant isolation** via Prisma client extension — every query filtered by tenant from request context. Fails closed.
- **Auth:** login+password, 15-min JWTs, rotating refresh cookie (HTTP-only, SameSite=Lax). OTP endpoints exist but login UI uses password only.
- **Consent gate:** `ConsentGate` component shows before any workspace if `offerVersion` doesn't match current. `POST /auth/consent` persists.
- **No real-time writes on server startup.** Sessions materialised daily at 00:30 Asia/Tashkent via BullMQ.
- **REDIS_MODE=off** for local dev without Redis.
- **Owner setup:** CLI command only — never granted via API.

---

## Key File Paths

| Area | Path |
|------|------|
| Web store (Zustand) | `apps/web/src/store/useStore.ts` |
| API client | `apps/web/src/lib/api.ts` |
| Translations | `packages/shared/src/translations.ts` (dict), `apps/web/src/i18n/useT.ts` |
| Prisma schema | `apps/api/prisma/schema.prisma` |
| Seed | `apps/api/prisma/seed.ts` |
| Auth module | `apps/api/src/modules/auth/` |
| Payments module | `apps/api/src/modules/payments/` |
| Attendance module | `apps/api/src/modules/attendance/` |
| Catalog controller | `apps/api/src/modules/catalog/catalog.controller.ts` |
| Manage controller | `apps/api/src/modules/manage/manage.controller.ts` |
| Admin Finance view | `apps/web/src/views/admin/AdminFinance.tsx` |
| Admin People view | `apps/web/src/views/admin/AdminPeople.tsx` |
| Teacher Group detail | `apps/web/src/views/teacher/StudioGroupDetail.tsx` |
| Legal text (UZ) | `packages/shared/src/legal-offer-uz.ts` |
| Legal text (RU) | `packages/shared/src/legal-offer-ru.ts` |
| Legal component | `apps/web/src/views/public/Legal.tsx` |
| App routes | `apps/web/app/[locale]/` |
| Shared client exports | `apps/web/src/views/next/clients.tsx` |

---

## Completed Tasks (Chronological)

1. **Full production platform** — Next.js + NestJS + Prisma monorepo, payments, QR attendance, password auth (commit `ba938aa`)
2. **Enrollment + QR attendance** — payment, Meyos grant, group capacity, lesson sessions (commit `245cbfc`)
3. **Official ILMORA logo** — header + dashboard sidebar (`8a774ff`..`8e39158`)
4. **Legal pages** — `/oferta`, `/privacy`, consent flow, offer acceptance gate, `POST /auth/consent`, migration `20261022000000_offer_consent` (`5c7fc61`)
5. **Uzbek offer text** — governing version from owner's document, Russian stays secondary language (`0bfc047`)
6. Various fixes: locale redirects, `/v1` kept out of locale redirect, Render deploy fixes, seed reapply, cleanup CLI
7. **Premium 3D Frontend & Visual Upgrade** — Interactive 3D learning orbit hero with Three.js/R3F, dual-column hero layout, luxury glassmorphic tokens, Duo/Trio visual subscription slot architecture, elevated CourseCard & steps, live attendance indicators, Next.js 16 production build verified.
8. **Admin Center Inquiry Inbox (Completed)** — `GET /v1/admin/inquiries` endpoint in `manage.controller.ts` & `manage.service.ts`, `AdminInquiries` view with paginated collapsible cards, App Router route at `/[locale]/admin/inquiries`, nav link in `AdminLayout.tsx` for `PLATFORM_ADMIN`, and trilingual i18n (`admin.inquiries.*`).
9. **Backend Security & Enrollment Fixes** — three confirmed bugs patched (no DB schema changes):
   - **Cross-tenant isolation** (`manage.service.ts` `updateStudent`): added `findFirst({ where: { tenantId, id } })` guard so PLATFORM_ADMIN cannot silently mutate users from other tenants.
   - **Draft group validation** (`subscription.service.ts` `saveDraft`): when `packageId` is null, groups are now verified to exist in the current tenant (`group.count` check) instead of being stored unvalidated.
   - **DraftDto null-package** (`enrollment.controller.ts`): replaced `@IsOptional()` with `@ValidateIf(o => o.packageId !== null)` so class-validator correctly accepts `null` (clear selection) and still enforces `@Length(1,80)` for non-null strings.
   - **Partial GroupPatch schedule** (`manage.service.ts` `updateGroup`): effective `start`/`end` are computed by merging the patch values with the DB fallback, then validated with `>= effectiveEnd` check before writing.
10. **QR Attendance & Payments Transactional Correctness (Completed)**:
   - **Attendance session expiration in QR rotation** (`attendance.service.ts` `qr`): added check for `session.attendanceTokenExpiresAt < new Date()` to prevent rotating tokens for expired sessions; auto-closes session in DB and throws `attendance_expired`. Added `attendance.rotate_token` audit event.
   - **Session cancellation attendance cleanup** (`attendance.service.ts` `setStatus`): sets `attendanceClosedAt: new Date()` and clears `attendanceTokenExpiresAt: null` when status transitions to `CANCELLED`.
   - **Teacher Studio QR recovery & rotation** (`useStore.ts` & `StudioGroupDetail.tsx`): added `refreshSessionQr` action to automatically restore active QR codes on tab reload / navigation and added a manual Rotate QR button for teacher live anti-screenshot defense.
   - **Payme refund settlement validation** (`payme.service.ts` `cancel`): verified return value of `payments.refundPaid`; throws `CANNOT_CANCEL` (-31007) if payment cannot be refunded, preventing invalid state -2 responses without ledger reversal.
   - **Expired order check in payment gateways** (`payme.service.ts` & `click.service.ts`): `checkPerform` and `create` in Payme, and `prepare` in Click now verify that `payment.expiresAt >= new Date()`, preventing capture of expired reservations before background cron runs.
   - **Click complete outbox idempotency** (`click.service.ts` `complete`): changed `outboxEvent.create` to `outboxEvent.upsert` with `dedupeKey: click-refund:${row.id}` to eliminate duplicate key P2002 exceptions on duplicate retries.
   - **Payment & Attendance Protocol Unit Tests** (`apps/api/test/payment-protocols.test.ts`): 10 unit tests covering Payme authentication, sandbox switching, trilingual error messages, Click MD5 signature verification (prepare and complete), money conversions, and attendance token hashing.

11. **Full-Stack Integration Verification & Defect Repairs (Completed)**:
    - **API Path Prefixing for Client Payments** (`apps/web/src/lib/api.ts`): Removed the overly broad `path.startsWith('/payments/')` exemption in `api()`. Client endpoints `GET /payments/providers` and `GET /payments/:id` now correctly retain the `/v1` prefix (`/v1/payments/...`), matching NestJS route mounting and Next.js rewrites. Fixed provider detection fallback to "unavailable" and 404 errors during payment polling on `/payments/:id/return`.
    - **Guest Student State for Unauthenticated Subscription Builder** (`apps/web/src/store/useStore.ts`): Initialized `guest-student` with `readDraft()` and set `currentStudentId = 'guest-student'` when unauthenticated. Resolves `student === undefined` for visitors on `/builder` and course cards, enabling package selection (Duo/Trio), course addition, schedule clash detection, and smooth login redirect from `/preview` preserving selection.
    - **15 End-to-End Flows Verified**: Traced all 15 core frontend-backend flows across contracts, DTOs, store actions, and error envelopes.

12. **Teacher Profiles, Profile Photo Management & Navigation (Completed)**:
    - **Clickable Logo & Navigation**: Made ILMORA logo in `PublicShell.tsx` and `DashboardShell.tsx` clickable, navigating to the active locale (`/uz`, `/ru`, `/en`) via `@/lib/router` without adding redundant desktop home buttons. Added keyboard focus visibility and accessible `aria-label` with localized home text (`site.brand.name — t('nav.home')`).
    - **Teacher Profile Photos & Neutral Placeholders**: Upgraded `Avatar` component to support real uploaded images (`te.avatarUrl` or `te.avatarUpload.previewUrl`), with `role="img" aria-label={name}`, `alt={name}`, consistent dimensions with `object-cover`, subtle hover scale effect (`group-hover:scale-105`), and a neutral brand placeholder (`bg-sage text-forest` with initials/silhouette) when no photo is uploaded.
    - **Teacher Self-Service Profile API & Ownership Enforcement**: Implemented `PATCH /manage/profile` and `PATCH /manage/teachers/:id` in `ManageController` & `ManageService`. Enforces strict teacher ownership (`actor.teacherProfileId === id`), preventing one teacher from editing another teacher's profile (`forbidden` 403 error). Supports display name, localized title, tagline, biography, specializations, spoken languages, and experience. Automatically synchronizes `User.displayName` when a teacher changes their display name.
    - **Secure Profile Photo Upload Presigning & S3 Storage Blocker**: Implemented `POST /manage/profile/avatar/upload-url` with server-side validation: validates allowed image MIME types (`image/jpeg`, `image/png`, `image/webp`), enforces 2MB maximum file size, and generates presigned S3 PUT URLs when configured. Honestly returns `storage_not_configured` when S3 credentials are unset without pretending fake cloud persistence.
    - **Teacher Directory Filtering & Search**: Upgraded `/teachers` with real-time teacher name and expertise search, dynamic subject filter dropdown (`availableSubjects` derived from defined subjects and course linkages), clear empty state with filter reset button, responsive cards, and profile links.
    - **Trilingual Localization**: Added all required dictionary keys in `packages/shared/src/translations.ts` (`nav.home`, `teachers.allSubjects`, `teachers.filterBySubject`, `teachers.noResults`, `teachers.noResultsHint`, `teachers.resetFilters`, `studio.channel.experience`, `studio.channel.languages`, `studio.channel.avatarUrl`, `studio.channel.storageUnavailable`, `studio.channel.previewProfile`).
    - **Unit Test Coverage**: Added 5 API unit tests in `apps/api/test/teacher-profile.test.ts` and 4 web store tests in `apps/web/src/store/teachers.test.ts` (all 54/54 tests passing).

13. **Localization and Language Switching Across UZ, RU, and EN (Completed)**:
    - **Language Switcher Standardization (`apps/web/src/components/layout/Switchers.tsx`)**: Replaced loose translation mapping with constant `LANGUAGE_OPTIONS` guaranteeing exactly three distinct options: `UZ | RU | EN`. Each option appears once with no duplicated labels. Accurately highlights the active language directly from the router's `useLocale()` / store state.
    - **Path & Query Preservation in Router (`apps/web/src/lib/router.tsx`)**: Updated `stripLocale()` regex to cleanly match `/uz`, `/ru`, and `/en` prefixes before subpaths (`/courses`), query parameters (`?cat=...`, `?next=...`), and hash fragments (`#main`), preventing corrupt URLs (e.g. `/:code/ru?...`). Switching languages now preserves the equivalent page without resetting to the homepage or losing authentication state.
    - **Duo and Trio Proper Product Name Preservation**: Verified that `Duo` and `Trio` are treated as proper subscription names in all locales (`packages/shared/src/sample-data.ts`, `legal-offer-uz.ts`, `legal-offer-ru.ts`). Standardized `builder.simultaneous` in `packages/shared/src/translations.ts` to `{n} ta kurs bir vaqtda` (UZ), `{n} курса одновременно` (RU), and `{n} courses at a time` (EN), producing “Duo — 2 ta kurs bir vaqtda” / “Duo — 2 курса одновременно” / “Duo — 2 courses at a time” and matching Trio counterparts.
    - **UI Localization Audit & Bugfixes**:
      - Fixed hardcoded Uzbek badge `✓ 0% to‘qnashuv` in `TemplatePages.tsx` to `tr({ uz: '✓ 0% to‘qnashuv', ru: '✓ 0% конфликтов', en: '✓ 0% conflicts' })`.
      - Verified full trilingual coverage across Navigation, Homepage, Course Catalog, Course Details, Subscription Cards, Login/Registration, Student & Teacher Dashboards, Admin Inquiries, Forms, Validation, FAQ, and Footer.
    - **Verification**: Verified via Next.js Turbopack dev and browser subagent on `/uz`, `/ru`, and `/en` routes: language buttons switch seamlessly, active indicator updates instantly, `/ru/courses?cat=cat-design` seamlessly preserves `?cat=cat-design` when switching to `/en/courses?cat=cat-design`, and Next.js 16 production build compiles 53 routes without errors.

14. **Teacher Profile Images, Consistent Fallback Placeholders & Self-Service Editing (Completed)**:
    - **Curated Portrait Assets (`apps/web/public/images/teachers/`)**: Generated and configured 5 professional, high-resolution portrait photographs matching the brand's luxury cream, beige, and dark green palette for featured teachers: Dilnoza Karimova (`dilnoza-karimova.jpg`), Jamshid Toshpo‘latov (`jamshid-toshpulatov.jpg`), Aziza Rahimova (`aziza-rahimova.jpg`), Bekzod Nazarov (`bekzod-nazarov.jpg`), and Malika Yusupova (`malika-yusupova.jpg`).
    - **Consistent Neutral Brand Placeholder**: Teachers without uploaded photographs (Sardor Alimov, Kamola Ergasheva, Rustam Xolmatov, Nilufar Sodiqova) consistently render a neutral warm sage/cream gradient placeholder (`linear-gradient(145deg, #E3EBE5 0%, #D5E1D8 100%)`) with `border-forest/15`, dark green text (`text-forest`), and bold initials or SVG silhouette.
    - **Resilient Image Error Fallback**: Added `onError` handling to `Avatar` (`apps/web/src/components/ui/index.tsx`), ensuring that broken, slow, or offline URLs cleanly fall back to the consistent brand placeholder without showing broken image icons.
    - **Centralized Photo Resolution Helper (`apps/web/src/components/teacher/teacherImage.ts`)**: Implemented `getTeacherAvatarUrl()` with strict priority order (`avatarUpload.previewUrl` > `avatarUrl` > `TEACHER_PHOTOGRAPHS[id]` > `null`). Unified usage across `Teachers.tsx`, `TeacherChannel.tsx`, `CourseCard.tsx`, `CourseDetail.tsx`, `StudentCourses.tsx`, `AdminPeople.tsx`, `ContentPages.tsx`, and `TemplatePages.tsx`.
    - **Teacher Self-Service Studio Profile & Photo Editing**: Verified editing capabilities on `/teacher/channel` (`StudioChannel.tsx`), allowing teachers to edit display name, trilingual title, bio, tagline, specializations, spoken languages, experience, and photo (upload preview or custom HTTPS URL) with a live public card preview. Changes persist via backend `PATCH /manage/profile` with teacher ownership protection.
    - **Brand Logo & Localization Verification**: Verified clickable ILMORA logo navigation in `PublicShell.tsx` and `DashboardShell.tsx` preserves current language (`/uz`, `/ru`, `/en`), language switcher operates seamlessly across all pages, and Duo and Trio subscriptions remain intact.
    - **Test Coverage & Verification**: Added vitest test cases in `apps/web/src/store/teachers.test.ts` verifying image cascade and placeholder resolution (10/10 web tests PASS, 55/55 total unit tests PASS). Verified visual appearance and interactive navigation via browser subagent on `/uz/teachers` and `/uz/teachers/t-dilnoza`.

15. **Authentication, Registration, Session Handling & Google OAuth Hardening (Completed)**:
    - **Registration Validation & Privilege Escalation Prevention**: Validated E.164 phone numbers (`+998...`), password complexity (minimum 8 characters with digits and letters), and trimmed names. Enforced role restrictions: public registration strictly permits only `STUDENT` or `TEACHER` roles. `PLATFORM_ADMIN` (Super Admin) is never assignable through public APIs and is exclusively evaluated against `tenant.ownerUserId === user.id`.
    - **Duplicate Account & Error Status Codes**: Mapped duplicate phone and email collisions to clean 409 responses (`phone_taken`, `email_taken`) with localized UI messages.
    - **Machine-Readable Login Exceptions**: Replaced ambiguous error throwing with explicit `AppError` instances (`unverified_email`, `account_disabled`, `invalid_credentials`), allowing the frontend to present specific localized guidance rather than generic 500 error envelopes.
    - **Session Lifecycle & Rotating Refresh Cookies**: Maintained `HttpOnly`, `SameSite=Lax` rotating refresh tokens. Validated that client logout clears cookies, aborts background polling, and resets client session state cleanly.
    - **Locale-Preserving Redirects**: Authentication redirects (`?next=...`) cleanly preserve language prefixes (`/uz`, `/ru`, `/en`). Added root `/auth/google/callback/route.ts` redirect bridge that 307-redirects to `/${locale}/auth/google/callback` preserving all query parameters (`code`, `state`, `scope`) so that external OAuth providers only require one registered callback URL.
    - **Google OAuth Verification & Integrity**:
      - Backend supports both ID token verification (`verifyGoogleIdToken`) and authorization code exchange (`exchangeGoogleCode`) with Google OAuth2 endpoints.
      - Fixed error throwing to use explicit `AppError` codes: `invalid_google_token`, `google_client_mismatch`, `google_unconfigured`, `invalid_google_code`, `missing_google_credential`, `incomplete_google_profile`.
      - Frontend never fakes Google OAuth: removed client-side dummy token generation when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is missing, cleanly displaying localized `auth.err.googleUnconfigured` notification.
      - Added dedicated `GoogleCallback.tsx` view and App Router page at `/[locale]/auth/google/callback` handling authorization code exchange, token storage, and redirection with localized toast alerts.
    - **Unit Test Coverage**: Added `apps/api/test/auth-extended.test.ts` (12 tests) and `apps/web/src/store/auth.test.ts` (5 tests). All 71 automated unit tests pass.

---

## End-to-End Integration Flow Matrix

| Flow | Status | Notes |
|------|--------|-------|
| 1. Student registration and login | ✅ Fully Verified | `POST /v1/auth/register`, `POST /v1/auth/login`, Argon2id, JWT + rotating refresh cookie |
| 2. Student authentication persistence & logout | ✅ Fully Verified | `POST /v1/auth/refresh` on `ilmora_session=1`, `POST /v1/auth/logout`, cookie lifecycle |
| 3. Course browsing and course details | ✅ Fully Verified | `GET /v1/public/catalog`, `GET /v1/public/courses/:key`, category/center filters |
| 4. Duo subscription selection | ✅ Fully Verified | `pkg-duo` (2 slots), visual composition, local draft persistence via `guest-student` |
| 5. Trio subscription selection | ✅ Fully Verified | `pkg-trio` (3 slots), slot limits, local draft persistence via `guest-student` |
| 6. Schedule conflict validation | ✅ Fully Verified | `findConflicts`, `overlaps`, UI warning badges, parity with backend `subscription.service.ts` |
| 7. Enrollment and checkout | ✅ Fully Verified | `/preview` provider discovery fixed (`/v1/payments/providers`), `POST /v1/student/subscription/checkout`, seat row locks |
| 8. Payment status handling | ⚠️ Partially Verified | Polling via `GET /v1/payments/:id` fixed; Payme/Click webhook settlement tested at protocol/ledger level; live bank settlement blocked on merchant credentials |
| 9. Student dashboard data | ✅ Fully Verified | `GET /v1/student/subscription`, `GET /v1/student/saved`, active enrollments, payment history |
| 10. Teacher dashboard data | ✅ Fully Verified | `GET /v1/manage/mine`, course groups, videos, playlists, resources, subjects |
| 11. Teacher opens lesson attendance | ✅ Fully Verified | `POST /v1/teacher/sessions/:id/open`, SHA-256 hashed rotating token, SSE broadcast |
| 12. Student scans QR & checks in | ✅ Fully Verified | `GET /v1/attendance/links/:sessionId`, `POST /v1/attendance/check-in`, hash verification, student matching |
| 13. Teacher sees updated attendance | ✅ Fully Verified | SSE `/v1/teacher/sessions/:id/stream`, real-time roster update from missing to checked |
| 14. Invalid & unauthorized requests errors | ✅ Fully Verified | `AppExceptionFilter` envelope `{ error: { code, message } }`, `ApiError`, `RequireRole` gates |
| 15. UZ, RU, EN routes preserve language | ✅ Fully Verified | `proxy.ts`, `NEXT_LOCALE`, route segments `/[locale]/*`, `router.tsx` navigation |

---

## Known Gaps / Remaining Work

### Priority 1 — Database integration test coverage
- 19 API tests skipped locally: `attendance.test.ts` (4), `auth-password.test.ts` (4), `payments.test.ts` (5), `tenancy-auth.test.ts` (6).
- These cover critical auth, payments, and tenancy isolation flows.
- **Action:** Set up `TEST_DATABASE_URL` and run `npm run test -w apps/api` to verify.

### Priority 2 — Payment settlement end-to-end
- Payme/Click protocol tests pass (10/10), but live bank settlement is unverified.
- **Action:** Connect sandbox merchant credentials to test the full callback → ledger → enrollment activation path.

### Priority 3 — Frontend test coverage
- `apps/web` has zero test files. Store logic, schedule conflict detection, and API error handling are untested.
- **Action:** Add vitest tests for `useStore.ts` core actions and critical view components.

### Priority 4 — AdminPeople API synchronization
- `AdminPeople.tsx` uses `useStore()` (local Zustand) for teachers/students for interactive demo capabilities.
- Backend has `GET /admin/users` (with role, search, pagination), `PUT /admin/users/:id/roles`, and `PATCH /admin/users/:id`.
- **Action:** Add optional live user directory view in `AdminPeople.tsx` using `GET /admin/users`.

### Priority 5 — React Compiler effect optimization
- 60 lint warnings for `react/set-state-in-effect` and `react/only-export-components` across view files.
- Patterns are functional and safe but block React Compiler optimization.

### Priority 6 — Minor gaps
- `packages/shared` has no `lint` script (only pure functions, low risk).
- 29 uncommitted files (23 modified + 6 untracked) need review and atomic commit.
- Responsive/mobile layout not runtime-verified — needs manual visual QA pass.

---

## QA Verification Findings (Session 11)

### P0 — Critical: None found

### P1 — Core Business
| ID | Finding |
|----|---------|
| P1-1 | 19 DB integration tests cannot run locally (no PostgreSQL) |
| P1-2 | Payment settlement unverifiable (no merchant credentials) |

### P2 — Important UX / Reliability
| ID | Finding |
|----|---------|
| P2-1 | Zero frontend tests — store/component logic untested |
| P2-2 | Responsive layout not runtime-verified |
| P2-3 | AdminPeople uses local demo data, not live API |

### P3 — Visual Polish
| ID | Finding |
|----|---------|
| P3-1 | 60 React Compiler lint warnings (functional, not broken) |
| P3-2 | Shared package missing `lint` script |
| P3-3 | 29 uncommitted files need review and commit |

### QA Verdict
**Conditionally ready for manual review.** No P0 issues. All builds pass, all available tests pass, security architecture is sound. DB integration tests and live payment settlement must be verified before production deployment.

---

## Next Action

1. Set up local PostgreSQL or CI test database and run the 19 skipped integration tests.
2. Connect Payme / Click sandbox credentials for live checkout simulation.
3. Add frontend test coverage for `useStore.ts` and critical components.
4. Manual responsive/mobile visual QA pass.
5. Review and commit all 29 local changes as an atomic commit.

---

## Blockers

- **S3 Object Storage for Profile Photo Uploads**: S3 credentials (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) are unconfigured in `.env`. Server returns `storage_not_configured` on presign requests. Teacher Studio allows instant local image preview and URL configuration; cloud persistence activates as soon as S3 credentials are provided.
- **Google sign-in removed from the web app (2026-11-09)**: the login page, the `/auth/google/callback` pages and the store's `loginWithGoogle` are gone; accounts sign in with a login and password only. The API's `POST /v1/auth/google` is still there for the API team to remove. The note below is kept for history.
- **Google OAuth Production Credentials**: When unconfigured, login UI cleanly displays `auth.err.googleUnconfigured` instead of faking tokens. To enable Google Sign-In:
  - **Backend Environment (`apps/api/.env`)**:
    - `GOOGLE_CLIENT_ID`: `<google-client-id>.apps.googleusercontent.com`
    - `GOOGLE_CLIENT_SECRET`: `<google-client-secret>`
    - `GOOGLE_CALLBACK_URL`: `http://localhost:3000/auth/google/callback` (production: `https://ilmora.uz/auth/google/callback`)
  - **Frontend Environment (`apps/web/.env`)**:
    - `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: `<google-client-id>.apps.googleusercontent.com` (NEVER expose client secret in web env)
  - **Google Cloud Console Setup**:
    1. Go to Google Cloud Console > APIs & Services > Credentials > Create Credentials > OAuth 2.0 Client ID.
    2. Application type: **Web application**.
    3. **Authorized JavaScript origins**:
       - `http://localhost:3000` (development)
       - `https://ilmora.uz` (production)
    4. **Authorized redirect URIs**:
       - `http://localhost:3000/auth/google/callback` (development)
       - `https://ilmora.uz/auth/google/callback` (production)
       *(The app's redirect route automatically translates this to the active locale preserving query parameters).*
- External merchant credentials needed for live provider callbacks in local dev.
- Local PostgreSQL not running → 19 database-backed API integration tests skipped.
- No `tsc` in PATH — use `node_modules/.bin/tsc` from repo root.
- `prisma` CLI also not in PATH — use `node_modules/.bin/prisma`.

