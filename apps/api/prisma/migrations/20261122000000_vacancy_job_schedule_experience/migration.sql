-- ТЗ ILMORA «Студенты у компании, Вакансии у учреждения», раздел 5 и открытый вопрос раздела 8: у «Работы» — график и
-- требуемый опыт (Нозим, 11.11). Списком, не текстом: по ним фильтруют студент и учреждение.
-- WorkSchedule: FULL_TIME, PART_TIME, SHIFT, FLEXIBLE (на месте или удалённо — это WorkFormat, не график).
-- ExperienceLevel: NONE, UP_TO_1, ONE_TO_3, OVER_3.
-- "Vacancy_job_terms_check": у практики и стажировки этих полей нет. «У Работы обязательны» база пока не требует:
-- бэкенд в main (#84) создаёт «Работу» без них, и до кода, который их ставит, такая проверка ломала бы создание
-- вакансий. Обязательность — в API; в базе — отдельной миграцией, когда код начнёт их заполнять.
-- Новые типы, а не новые значения старых — поэтому одной миграцией. Совместимо с кодом прошлого релиза: новые
-- необязательные колонки, проверку проходят все существующие строки (у них поля пустые).
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TYPE "WorkSchedule" AS ENUM ('FULL_TIME', 'PART_TIME', 'SHIFT', 'FLEXIBLE');
CREATE TYPE "ExperienceLevel" AS ENUM ('NONE', 'UP_TO_1', 'ONE_TO_3', 'OVER_3');

ALTER TABLE "Vacancy" ADD COLUMN "experience" "ExperienceLevel",
ADD COLUMN "schedule" "WorkSchedule";

ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_job_terms_check" CHECK (
  "kind" = 'JOB' OR ("schedule" IS NULL AND "experience" IS NULL)
);

COMMIT;
