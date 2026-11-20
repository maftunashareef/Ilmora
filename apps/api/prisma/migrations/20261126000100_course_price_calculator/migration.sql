-- ТЗ 2026-11-18, раздел 9 «Калькулятор цены курса» (решение 18.11; Тимур, 20.11: минимум скидки 5% — для новых курсов,
-- даты у скидки остаются): комиссия ILMORA у организации (одна на все центры, меняет только Super Admin), признак курса,
-- созданного с калькулятором (priceRule = 1: цена — целые тысячи от 50 000 сум, цена для студента — вниз до 1 000 сум),
-- и снимок расчёта в строке платежа (S, K, доля центра, доля ILMORA).
-- Совместимо с кодом прошлого релиза: только новые колонки с умолчанием или NULL. Старый код их не читает и не пишет:
-- курсы с priceRule = 0 считаются как всегда, строки платежа без снимка — NULL. Добавление колонки с постоянным
-- умолчанием в PostgreSQL 16 не переписывает таблицу.
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE "Tenant" ADD COLUMN "commissionPercent" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Course" ADD COLUMN "priceRule" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentLine" ADD COLUMN "centerShareMinor" BIGINT,
ADD COLUMN "commissionPercent" INTEGER,
ADD COLUMN "discountPercent" INTEGER,
ADD COLUMN "platformShareMinor" BIGINT;

-- 2% at least keeps ILMORA's share above the rounding loss (at most 990 so'm) for any price from 50 000 so'm.
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_commissionPercent_check" CHECK ("commissionPercent" BETWEEN 2 AND 50);
-- NOT VALID: existing rows are 0 / NULL and fit; the check holds for every row written from now on without scanning the table.
ALTER TABLE "Course" ADD CONSTRAINT "Course_priceRule_check" CHECK ("priceRule" IN (0, 1)) NOT VALID;
-- The snapshot is whole or absent; the shares are not negative and add up to what the line paid.
ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_split_check" CHECK (
  ("centerShareMinor" IS NULL AND "platformShareMinor" IS NULL AND "commissionPercent" IS NULL AND "discountPercent" IS NULL)
  OR ("centerShareMinor" >= 0 AND "platformShareMinor" >= 0 AND "centerShareMinor" + "platformShareMinor" = "amountMinor"
      AND "commissionPercent" BETWEEN 0 AND 100 AND "discountPercent" BETWEEN 0 AND 100)
) NOT VALID;

COMMIT;
