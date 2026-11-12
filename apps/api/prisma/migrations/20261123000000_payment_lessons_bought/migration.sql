-- №78 (перепроверка Шерзода 11.11, Нозим): сколько уроков принёс каждый платёж пакета «по урокам». Уроки лежали только
-- на подписке (lessonsTotal, lessonsUsed), продление прибавляло к остатку — и отмена в кабинете Payme не знала, сколько
-- снять: отмена продления снимала подписку целиком, отмена первого платежа оставляла все уроки.
-- Payment.lessonsBought — уроки, которые платёж покупает; у помесячных подписок — NULL. CHECK: не меньше нуля.
-- Заполнение старых платежей подписок LESSONS:
--   - у подписки ровно один проведённый платёж (PAID или REFUNDED) — у него точное число: lessonsTotal подписки (при
--     первой оплате остатка нет, lessonsTotal = уроки этого платежа);
--   - остальные — число уроков пакета сейчас: точнее не узнать; если число в пакете не меняли, это и есть правда.
-- Совместимо с кодом прошлого релиза: новая необязательная колонка, старый код её не читает.
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE "Payment" ADD COLUMN "lessonsBought" INTEGER;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_lessonsBought_check" CHECK ("lessonsBought" IS NULL OR "lessonsBought" >= 0);

WITH settled AS (
  SELECT "subscriptionId", count(*) AS n FROM "Payment" WHERE "state" IN ('PAID', 'REFUNDED') GROUP BY "subscriptionId"
)
UPDATE "Payment" p
SET "lessonsBought" = CASE
  WHEN p."state" IN ('PAID', 'REFUNDED') AND st.n = 1 AND s."lessonsTotal" IS NOT NULL THEN s."lessonsTotal"
  ELSE pk."lessonCount" END
FROM "Subscription" s
JOIN "Package" pk ON pk."id" = s."packageId"
LEFT JOIN settled st ON st."subscriptionId" = s."id"
WHERE p."subscriptionId" = s."id"
  AND s."kind" = 'LESSONS'
  AND pk."lessonCount" IS NOT NULL;

COMMIT;
