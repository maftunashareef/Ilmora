-- Раздел «Студенты» у компании: суточный лимит показанных карточек (не больше 1000 за 24 часа на компанию), чтобы
-- список студентов нельзя было выкачать перебором страниц. Журнал показов: одна строка на показанную страницу с числом
-- карточек на ней; лимит — сумма "cards" по ("companyId", "createdAt") за последние 24 часа. Считается по компании, а
-- не по аккаунту (смена представителя лимит не сбрасывает), и в базе (перезапуск сервера счётчик не сбрасывает). Кто
-- кого видел — в журнале аудита (student.card.view); там компания лежит только в JSON без индекса, поэтому счёт
-- ведётся здесь.
-- Совместимо с кодом прошлого релиза: только новая таблица, старый код её не читает и не пишет.
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE "CompanyStudentCardView" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cards" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyStudentCardView_pkey" PRIMARY KEY ("id"),
    -- A row is a page that was shown: at least one card.
    CONSTRAINT "CompanyStudentCardView_cards_check" CHECK ("cards" > 0)
);

CREATE INDEX "CompanyStudentCardView_companyId_createdAt_idx" ON "CompanyStudentCardView"("companyId", "createdAt");

ALTER TABLE "CompanyStudentCardView" ADD CONSTRAINT "CompanyStudentCardView_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
