-- ТЗ ILMORA «Студенты у компании, Вакансии у учреждения» (11.11), раздел 6.1, пункты 3–5.
-- 3: a contact request from the «Студенты» section shares the named-card rule with graduation announcements: one
--    request per company and student across both, so the section shows the status of an earlier request instead of
--    asking again. "ContactRequest_named_once" replaces "ContactRequest_graduate_once" (20261119000000). The anonymous
--    contract-help card keeps its own request (once per company and card): sharing it with a named card would tell the
--    company whose card it is (security review 11.11, №126).
-- 4: vacancy broadcasts — an institution sends a vacancy to its own confirmed students: the journal row, its
--    directions, and one recipient row per student; (vacancyId, userId) is unique, so a student gets a vacancy once
--    and a retried batch adds nothing.
-- 5: no new index for selecting students: measured on a load copy (200 000 students, 96 000 confirmed), the existing
--    ones serve it — a company's institution blocks 0.16 s, one institution's page of students 1.4 ms, a broadcast
--    preview 0.5 ms; a partial index on confirmed students saved nothing (0.14 s).
-- Also, «Работа» (ТЗ 5): salary columns «from–to» (the ТЗ leaves «one amount or a range» open; one amount is «from»
--    alone), a salary only on a JOB and a stipend never on one, a JOB always paid (Нозим, 11.11).
-- Compatible with the code of the previous release: new tables and nullable columns, one index swapped for a wider one
-- (the GRADUATE rule is unchanged), checks that every existing row passes (no JOB vacancies, no salaries yet).
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

-- 3. Contact requests: one per company and student over the named channels.
DROP INDEX "ContactRequest_graduate_once";
CREATE UNIQUE INDEX "ContactRequest_named_once" ON "ContactRequest" ("companyId", "userId")
  WHERE "source" IN ('GRADUATE', 'STUDENTS');

-- 4. Vacancy broadcasts.
CREATE TABLE "VacancyBroadcast" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "courses" INTEGER[],
    "createdById" TEXT NOT NULL,
    "recipientsCount" INTEGER NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VacancyBroadcast_pkey" PRIMARY KEY ("id"),
    -- At least one year of study, each 1–11 (a school class goes up to 11), no empty elements.
    CONSTRAINT "VacancyBroadcast_courses_check" CHECK (
      "courses" IS NOT NULL AND cardinality("courses") >= 1 AND array_position("courses", NULL) IS NULL
      AND 1 <= ALL ("courses") AND 11 >= ALL ("courses")
    ),
    CONSTRAINT "VacancyBroadcast_recipientsCount_check" CHECK ("recipientsCount" >= 0)
);

CREATE TABLE "VacancyBroadcastDirection" (
    "broadcastId" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,

    CONSTRAINT "VacancyBroadcastDirection_pkey" PRIMARY KEY ("broadcastId","directionId")
);

CREATE TABLE "VacancyBroadcastRecipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VacancyBroadcastRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VacancyBroadcast_tenantId_institutionId_createdAt_idx" ON "VacancyBroadcast"("tenantId", "institutionId", "createdAt");
CREATE INDEX "VacancyBroadcast_vacancyId_idx" ON "VacancyBroadcast"("vacancyId");
CREATE UNIQUE INDEX "VacancyBroadcast_id_vacancyId_key" ON "VacancyBroadcast"("id", "vacancyId");
CREATE INDEX "VacancyBroadcastDirection_directionId_idx" ON "VacancyBroadcastDirection"("directionId");
CREATE INDEX "VacancyBroadcastRecipient_broadcastId_idx" ON "VacancyBroadcastRecipient"("broadcastId");
CREATE INDEX "VacancyBroadcastRecipient_tenantId_userId_idx" ON "VacancyBroadcastRecipient"("tenantId", "userId");
CREATE UNIQUE INDEX "VacancyBroadcastRecipient_vacancyId_userId_key" ON "VacancyBroadcastRecipient"("vacancyId", "userId");

ALTER TABLE "VacancyBroadcast" ADD CONSTRAINT "VacancyBroadcast_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VacancyBroadcast" ADD CONSTRAINT "VacancyBroadcast_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VacancyBroadcast" ADD CONSTRAINT "VacancyBroadcast_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VacancyBroadcastDirection" ADD CONSTRAINT "VacancyBroadcastDirection_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "VacancyBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VacancyBroadcastDirection" ADD CONSTRAINT "VacancyBroadcastDirection_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VacancyBroadcastRecipient" ADD CONSTRAINT "VacancyBroadcastRecipient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VacancyBroadcastRecipient" ADD CONSTRAINT "VacancyBroadcastRecipient_broadcastId_vacancyId_fkey" FOREIGN KEY ("broadcastId", "vacancyId") REFERENCES "VacancyBroadcast"("id", "vacancyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VacancyBroadcastRecipient" ADD CONSTRAINT "VacancyBroadcastRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ТЗ 5: «Работа».
ALTER TABLE "Vacancy" ADD COLUMN "salaryFromMinor" BIGINT,
ADD COLUMN "salaryToMinor" BIGINT;
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_job_paid_check" CHECK ("kind" <> 'JOB' OR "paid");
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_pay_by_kind_check" CHECK (
  ("kind" = 'JOB' OR ("salaryFromMinor" IS NULL AND "salaryToMinor" IS NULL))
  AND ("kind" <> 'JOB' OR "stipendMinor" IS NULL)
);
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_salary_check" CHECK (
  ("salaryFromMinor" IS NULL OR "salaryFromMinor" > 0)
  AND ("salaryToMinor" IS NULL OR ("salaryFromMinor" IS NOT NULL AND "salaryToMinor" >= "salaryFromMinor"))
);

COMMIT;
