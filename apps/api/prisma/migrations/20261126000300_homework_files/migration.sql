-- ТЗ 2026-11-18, раздел 8.4 «ZIP до 1024 МБ», 12.3 (Нозим, 20.11): файлы домашних заданий — материалы учителя и сдачи
-- учеников. Сами архивы — в закрытом бакете S3_HOMEWORK_BUCKET (пока ilmora-docs, раздел homework/), здесь — запись о
-- каждом: чей, какого центра, ключ, размер, статус проверки, когда удалить (срок сдачи + 90 дней). Место центра —
-- Center.homeworkQuotaBytes, 20 ГБ по умолчанию. Строка файла остаётся и после удаления объекта (deletedAt): в истории
-- сдач видно, что файл был. Код загрузки — отдельно, вторая очередь.
-- Совместимо с кодом прошлого релиза: новые типы, таблица, колонки с умолчанием или NULL; ограничение сдачи «есть текст
-- или ссылка» расширено файлом — всё, что пишет прежний код (текст, ссылка), по-прежнему проходит.
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

-- CreateEnum
CREATE TYPE "HomeworkFileKind" AS ENUM ('MATERIAL', 'SUBMISSION');

-- CreateEnum
CREATE TYPE "HomeworkFileStatus" AS ENUM ('UPLOADING', 'CHECKING', 'READY', 'REJECTED');

-- AlterTable
ALTER TABLE "Center" ADD COLUMN     "homeworkQuotaBytes" BIGINT NOT NULL DEFAULT 21474836480;

-- AlterTable
ALTER TABLE "HomeworkSubmission" ADD COLUMN     "fileId" TEXT;

-- CreateTable
CREATE TABLE "HomeworkFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "homeworkId" TEXT NOT NULL,
    "kind" "HomeworkFileKind" NOT NULL,
    "uploadedById" TEXT,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "status" "HomeworkFileStatus" NOT NULL DEFAULT 'UPLOADING',
    "uploadId" TEXT,
    "rejectReason" TEXT,
    "entryCount" INTEGER,
    "unpackedBytes" BIGINT,
    "checkedAt" TIMESTAMP(3),
    "deleteAfter" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeworkFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomeworkFile_objectKey_key" ON "HomeworkFile"("objectKey");

-- CreateIndex
CREATE INDEX "HomeworkFile_tenantId_centerId_status_idx" ON "HomeworkFile"("tenantId", "centerId", "status");

-- CreateIndex
CREATE INDEX "HomeworkFile_tenantId_homeworkId_kind_idx" ON "HomeworkFile"("tenantId", "homeworkId", "kind");

-- CreateIndex
CREATE INDEX "HomeworkFile_deleteAfter_idx" ON "HomeworkFile"("deleteAfter");

-- CreateIndex
CREATE UNIQUE INDEX "HomeworkSubmission_fileId_key" ON "HomeworkSubmission"("fileId");

-- AddForeignKey
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "HomeworkFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkFile" ADD CONSTRAINT "HomeworkFile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkFile" ADD CONSTRAINT "HomeworkFile_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkFile" ADD CONSTRAINT "HomeworkFile_homeworkId_fkey" FOREIGN KEY ("homeworkId") REFERENCES "Homework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Checks the schema cannot say (Prisma does not describe CHECK constraints).
-- A ZIP of 1 byte … 1024 MB; the key only in the homework area of the bucket; the name a .zip.
ALTER TABLE "HomeworkFile" ADD CONSTRAINT "HomeworkFile_size_check" CHECK ("sizeBytes" BETWEEN 1 AND 1073741824);
ALTER TABLE "HomeworkFile" ADD CONSTRAINT "HomeworkFile_key_check" CHECK ("objectKey" LIKE 'homework/%' OR "objectKey" LIKE 'incoming/homework/%');
ALTER TABLE "HomeworkFile" ADD CONSTRAINT "HomeworkFile_name_check" CHECK (lower("fileName") LIKE '%.zip' AND length("fileName") <= 255);
-- A refusal says why; only a file being uploaded has a multipart upload; what the check read is not negative.
ALTER TABLE "HomeworkFile" ADD CONSTRAINT "HomeworkFile_reject_check" CHECK (("status" = 'REJECTED') = ("rejectReason" IS NOT NULL));
ALTER TABLE "HomeworkFile" ADD CONSTRAINT "HomeworkFile_upload_check" CHECK ("uploadId" IS NULL OR "status" = 'UPLOADING');
ALTER TABLE "HomeworkFile" ADD CONSTRAINT "HomeworkFile_contents_check" CHECK (("entryCount" IS NULL OR "entryCount" >= 0) AND ("unpackedBytes" IS NULL OR "unpackedBytes" >= 0));
-- A center's space is not negative.
ALTER TABLE "Center" ADD CONSTRAINT "Center_homeworkQuotaBytes_check" CHECK ("homeworkQuotaBytes" >= 0);
-- A hand-in has something in it: text, a link or a ZIP (was: text or link, migration 20261126000000).
ALTER TABLE "HomeworkSubmission" DROP CONSTRAINT "HomeworkSubmission_content_check";
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_content_check" CHECK ("text" IS NOT NULL OR "link" IS NOT NULL OR "fileId" IS NOT NULL);

COMMIT;
