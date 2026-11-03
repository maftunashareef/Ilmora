# Centers, schedules, offline attendance, subscriptions and notifications

Design note for the November 2026 update (branch `feat/centers-attendance-subscriptions-notifications`).
Everything here is enforced on the server; the web app only reflects it.

## 1. Educational Center accounts

- Registration offers three roles: Student, Teacher and **Educational Center** (`role: 'CENTER'`, `centerName` required).
  A center registration creates the `Center` row with `status = PENDING` and the account as its first `CENTER_ADMIN`
  (`User.centerId`). Super Admins are notified (`center.registered`).
- `Center.status`: `PENDING` (workspace works, catalog not public, courses cannot be published), `ACTIVE` (approved by
  the Super Admin), `BLOCKED` (hidden from the catalog, workspace locked). The public catalog lists only `ACTIVE` centers,
  their teachers and their courses.
- Center workspace (`/center`, API `/v1/center/*`, role `CENTER_ADMIN`, always scoped to `actor.centerId`):
  overview, courses (create / edit / publish / archive, groups and weekly schedules, per-lesson exceptions),
  teachers (profiles of the center, linking of registered teacher accounts), students (enrolled in the center's groups,
  attendance totals), today's lessons with per-lesson QR, the center QR and check-in settings.
  Center admins never get the Teacher Studio content API (videos, playlists, resources).

## 2. Schedules

- A group keeps its weekly pattern (`days`, `startTime`, `endTime`); the worker materialises `LessonSession` rows 28 days ahead.
- Exceptions live on the session rows: cancel / restore (status), **move** (same date: times change in place; another date:
  the original is cancelled and a new session is created with `rescheduledFromId`), **extra lesson** (`isExtra`, any date).
  The daily generator never touches existing rows, so exceptions survive regeneration.
- Pattern changes regenerate future scheduled sessions that have no attendance; exceptions are kept.
- Every change notifies the group's students and the teacher (`schedule.changed`, `schedule.cancelled`, `schedule.extra`).

## 3. Offline attendance with the center QR

- Each center has a standing QR code: `${webOrigin}/attend/c/<checkInCode>` (`Center.checkInCode`, rotatable).
  The per-lesson QR that teachers open stays as it was.
- A signed-in student who opens the center link sees the lessons of that center they are enrolled in today and checks
  in to the current one. The server accepts a check-in only when:
  1. the enrollment is `ACTIVE` and the subscription is not blocked (section 4),
  2. the lesson is at this center and is not cancelled,
  3. the time is inside the window `[startsAt − checkInBeforeMin, startsAt + absenceAfterMin]` (center settings,
     defaults 15 / 20 minutes),
  4. when the center has a location and radius, the browser's coordinates are inside `geoRadiusM` metres.
  The record is `PRESENT` / `CENTER_QR`. A repeated scan returns the existing record.
- **Absences:** every 5 minutes the worker takes lessons whose window closed (`startsAt + absenceAfterMin < now`,
  `absenceMarkedAt` null, not cancelled) and records `ABSENT` / `AUTO` for every active enrollment without a record, then
  stamps `absenceMarkedAt`. Lessons that started before this release were stamped by the migration, so nobody is marked
  absent retroactively. Students and center admins are notified (`attendance.absent`); teachers see check-ins live
  (`attendance.checkin`).
- Teachers and center admins override any record with a reason (existing correction endpoint). The honest wording stays:
  a scan plus a time window and a coarse location make skipping harder; they do not prove physical presence.

## 4. Subscriptions: period or lessons, automatic blocking and activation

- `Package.accessKind`: `PERIOD` (default; `periodDays` or one calendar month per payment) or `LESSONS` (`lessonCount`
  attended lessons per payment). The subscription copies the kind at checkout (`Subscription.kind`, `lessonsTotal`).
- A `PRESENT` record for a lesson consumes one lesson of a `LESSONS` subscription (`lessonsUsed`, flagged on the record
  so corrections can give it back).
- **Blocking** (`SubscriptionStatus.PAST_DUE`, `blockedAt`, `blockReason`): the period ended (`period_ended`) or the lessons
  are used up (`lessons_exhausted`). Blocked students cannot check in and lose access to private course materials; their
  seats are kept for `SUBSCRIPTION_GRACE_DAYS` (default 7). After the grace period the subscription becomes `EXPIRED` and
  the enrollments are cancelled (seats released). The worker runs this every 10 minutes with the payment expiry job.
- **Activation:** settlement of a payment (Payme, Click or a manual settlement) unblocks instantly: status `ACTIVE`,
  new period or a fresh lesson balance, reminders reset; the student is notified (`payment.confirmed`).
- Reminders: `subscription.expiring` 3 days before the period ends (once per period), `subscription.lessonsLow` when 2
  lessons remain, `subscription.expired` on blocking, `subscription.ended` when the seats are released.

## 5. Notifications

- `Notification` rows per user (`type`, `params`, `readAt`); texts are rendered in the reader's language from the shared
  dictionary (`notif.<type>`), so a notification reads correctly after a language switch.
- Live delivery: `GET /v1/notifications/stream` (server-sent events through Redis pub/sub, one channel per user), with
  `GET /v1/notifications` and `POST /v1/notifications/read` for the list and read marks. The dashboards show a bell with
  the unread count.
- Events: new enrollment (teacher + center admins), check-in (teacher), absence (student + center admins), schedule change
  or cancellation (group students + teacher), subscription reminders / expiry / payment confirmation (student),
  center registered / approved / blocked (Super Admins / center admins).

## 6. Super Admin

- Owners (`User.isOwner`) keep full oversight: `GET /v1/admin/centers` (all statuses), `PATCH /v1/admin/centers/:id/status`
  (approve, block, reopen), block or unblock any account (`isActive`), `DELETE /v1/admin/users/:id` (soft delete: sessions
  revoked, subscription cancelled, login freed), plus the existing roles, teachers, centers and audit endpoints.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SUBSCRIPTION_GRACE_DAYS` | 7 | Days a blocked subscription keeps its seats before expiring |
| `SUBSCRIPTION_REMIND_DAYS` | 3 | Days before the period end for the reminder |
| `ATTENDANCE_ABSENCE_SWEEP_MINUTES` | 5 | How often the worker records absences |

Per-center settings (workspace → settings): `checkInBeforeMin`, `absenceAfterMin`, location + `geoRadiusM`.
