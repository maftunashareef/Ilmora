-- ТЗ 2026-11-18, 9.2 (Нозим, 20.11): цена курса, созданного с калькулятором (priceRule = 1), — в базе, а не только в коде:
-- целые тысячи сум от 50 000 или 0 (бесплатный курс — это цена 0, отдельной колонки нет; Шерзод и Нозим, 20.11).
-- В тийинах: 1 000 сум = 100 000, 50 000 сум = 5 000 000. Курсы старого правила (priceRule = 0) не затронуты.
-- Совместимо с кодом прошлого релиза: он курсы с priceRule = 1 не создаёт и их цену не пишет (manage.service проверяет то же
-- самое — checkCoursePrice). Строки, нарушающие правило, если бы они были, остановили бы миграцию, и она откатилась бы целиком.
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

-- NOT VALID, затем VALIDATE: проверка существующих строк идёт под лёгкой блокировкой (SHARE UPDATE EXCLUSIVE), чтение и
-- запись курсов в это время не ждут.
ALTER TABLE "Course" ADD CONSTRAINT "Course_calculator_price_check" CHECK (
  "priceRule" = 0 OR "priceMinor" = 0 OR ("priceMinor" % 100000 = 0 AND "priceMinor" >= 5000000)
) NOT VALID;
ALTER TABLE "Course" VALIDATE CONSTRAINT "Course_calculator_price_check";

COMMIT;
