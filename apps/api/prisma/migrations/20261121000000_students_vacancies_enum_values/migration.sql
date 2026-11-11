-- ТЗ ILMORA «Студенты у компании, Вакансии у учреждения» (11.11), раздел 6.1, пункты 1–3: new enum values.
-- INDUSTRY_CARD — the student's consent «show my card to companies of my industry» (4); STUDENTS — a contact request
-- from the company's «Студенты» section (2.4); JOB — the vacancy kind «Работа» (5).
-- A migration of its own: PostgreSQL cannot use an enum value in the transaction that added it, and the next migration
-- (20261121000100) uses them in indexes and checks. Compatible with the code of the previous release: nothing writes
-- these values until the backend that uses them is released (its rollback boundary is noted in the infra README).
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TYPE "ConsentKind" ADD VALUE 'INDUSTRY_CARD';
ALTER TYPE "ContactSource" ADD VALUE 'STUDENTS';
ALTER TYPE "VacancyKind" ADD VALUE 'JOB';

COMMIT;
