-- ТЗ 2026-11-18 «ILMORA: студенты центров, ДЗ, калькулятор цены», первая очередь (разделы 4, 5, 8): таблица студентов
-- центра с приглашениями (CenterStudent, CenterStudentGroup), ручные отметки своих учеников центра в журнале группы
-- (CenterAttendanceMark; QR-отметки учеников ILMORA остаются в AttendanceRecord), домашние задания текстом и ссылкой
-- (Homework, HomeworkSubmission, HomeworkExtension; ZIP — вторая очередь).
-- Совместимо с кодом прошлого релиза: только новые типы, таблицы, индексы и внешние ключи на существующие таблицы;
-- существующие колонки и строки не меняются. Старый код новые таблицы не читает; при откате они просто лежат.
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

-- CreateEnum
CREATE TYPE "CenterStudentStatus" AS ENUM ('STUDYING', 'PAUSED', 'LEFT');

-- CreateEnum
CREATE TYPE "CenterStudentSource" AS ENUM ('CENTER', 'ILMORA');

-- CreateEnum
CREATE TYPE "CenterMarkStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE');

-- CreateEnum
CREATE TYPE "HomeworkSubmitMode" AS ENUM ('TEXT', 'LINK', 'ZIP');

-- CreateTable
CREATE TABLE "CenterStudent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "userId" TEXT,
    "source" "CenterStudentSource" NOT NULL DEFAULT 'CENTER',
    "fullName" TEXT NOT NULL,
    "phoneE164" TEXT,
    "birthDate" DATE,
    "institutionId" TEXT,
    "institutionType" "InstitutionType",
    "institutionText" TEXT,
    "studyYear" INTEGER,
    "parentName" TEXT,
    "parentPhoneE164" TEXT,
    "status" "CenterStudentStatus" NOT NULL DEFAULT 'STUDYING',
    "startedOn" DATE,
    "archivedAt" TIMESTAMP(3),
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "invitedAt" TIMESTAMP(3),
    "inviteSends" INTEGER NOT NULL DEFAULT 0,
    "inviteAcceptedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CenterStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CenterStudentGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "centerStudentId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CenterStudentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CenterAttendanceMark" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "centerStudentId" TEXT NOT NULL,
    "status" "CenterMarkStatus" NOT NULL,
    "markedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CenterAttendanceMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Homework" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submitModes" "HomeworkSubmitMode"[],
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Homework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeworkSubmission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "homeworkId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "text" TEXT,
    "link" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grade" INTEGER,
    "comment" TEXT,
    "gradedAt" TIMESTAMP(3),
    "gradedById" TEXT,

    CONSTRAINT "HomeworkSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeworkExtension" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "homeworkId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeworkExtension_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CenterStudent_inviteTokenHash_key" ON "CenterStudent"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "CenterStudent_tenantId_centerId_status_idx" ON "CenterStudent"("tenantId", "centerId", "status");

-- CreateIndex
CREATE INDEX "CenterStudent_tenantId_userId_idx" ON "CenterStudent"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CenterStudent_centerId_phoneE164_key" ON "CenterStudent"("centerId", "phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "CenterStudent_centerId_userId_key" ON "CenterStudent"("centerId", "userId");

-- CreateIndex
CREATE INDEX "CenterStudentGroup_tenantId_groupId_idx" ON "CenterStudentGroup"("tenantId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "CenterStudentGroup_centerStudentId_groupId_key" ON "CenterStudentGroup"("centerStudentId", "groupId");

-- CreateIndex
CREATE INDEX "CenterAttendanceMark_tenantId_centerStudentId_idx" ON "CenterAttendanceMark"("tenantId", "centerStudentId");

-- CreateIndex
CREATE UNIQUE INDEX "CenterAttendanceMark_sessionId_centerStudentId_key" ON "CenterAttendanceMark"("sessionId", "centerStudentId");

-- CreateIndex
CREATE INDEX "Homework_tenantId_groupId_dueAt_idx" ON "Homework"("tenantId", "groupId", "dueAt");

-- CreateIndex
CREATE INDEX "HomeworkSubmission_tenantId_homeworkId_studentId_submittedA_idx" ON "HomeworkSubmission"("tenantId", "homeworkId", "studentId", "submittedAt");

-- CreateIndex
CREATE INDEX "HomeworkSubmission_tenantId_studentId_idx" ON "HomeworkSubmission"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "HomeworkExtension_tenantId_studentId_idx" ON "HomeworkExtension"("tenantId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "HomeworkExtension_homeworkId_studentId_key" ON "HomeworkExtension"("homeworkId", "studentId");

-- AddForeignKey
ALTER TABLE "CenterStudent" ADD CONSTRAINT "CenterStudent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterStudent" ADD CONSTRAINT "CenterStudent_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterStudent" ADD CONSTRAINT "CenterStudent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterStudent" ADD CONSTRAINT "CenterStudent_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterStudentGroup" ADD CONSTRAINT "CenterStudentGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterStudentGroup" ADD CONSTRAINT "CenterStudentGroup_centerStudentId_fkey" FOREIGN KEY ("centerStudentId") REFERENCES "CenterStudent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterStudentGroup" ADD CONSTRAINT "CenterStudentGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterAttendanceMark" ADD CONSTRAINT "CenterAttendanceMark_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterAttendanceMark" ADD CONSTRAINT "CenterAttendanceMark_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LessonSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterAttendanceMark" ADD CONSTRAINT "CenterAttendanceMark_centerStudentId_fkey" FOREIGN KEY ("centerStudentId") REFERENCES "CenterStudent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_homeworkId_fkey" FOREIGN KEY ("homeworkId") REFERENCES "Homework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkExtension" ADD CONSTRAINT "HomeworkExtension_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkExtension" ADD CONSTRAINT "HomeworkExtension_homeworkId_fkey" FOREIGN KEY ("homeworkId") REFERENCES "Homework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkExtension" ADD CONSTRAINT "HomeworkExtension_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Checks the schema cannot say (Prisma does not describe CHECK constraints).
-- A class at school is 1–11, a year of study 1–6; a link is sent at most 4 times (the first one and 3 more, ТЗ 4.3).
ALTER TABLE "CenterStudent" ADD CONSTRAINT "CenterStudent_studyYear_check" CHECK ("studyYear" IS NULL OR "studyYear" BETWEEN 1 AND 11);
ALTER TABLE "CenterStudent" ADD CONSTRAINT "CenterStudent_inviteSends_check" CHECK ("inviteSends" BETWEEN 0 AND 4);
-- The archive tab is exactly the records with status LEFT.
ALTER TABLE "CenterStudent" ADD CONSTRAINT "CenterStudent_archive_check" CHECK (("status" = 'LEFT') = ("archivedAt" IS NOT NULL));
-- A phone is the center's own entry: records that came through ILMORA keep none, so "one phone per center" is about
-- the center's entries only.
ALTER TABLE "CenterStudent" ADD CONSTRAINT "CenterStudent_ilmora_phone_check" CHECK ("source" = 'CENTER' OR "phoneE164" IS NULL);
-- A homework is handed in some way; a hand-in has something in it; a grade is 1–5 and has its time.
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_submitModes_check" CHECK (cardinality("submitModes") >= 1 AND array_position("submitModes", NULL) IS NULL);
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_content_check" CHECK ("text" IS NOT NULL OR "link" IS NOT NULL);
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_grade_check" CHECK ("grade" IS NULL OR ("grade" BETWEEN 1 AND 5 AND "gradedAt" IS NOT NULL));

COMMIT;
