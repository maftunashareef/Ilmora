-- «Работа»: график и требуемый опыт обязательны — теперь и в базе (ТЗ «Студенты у компании», раздел 5; Нозим, 11.11).
-- В 20261122000000 база проверяла только «у практики и стажировки их нет»: тогдашний код создавал «Работу» без них. С
-- коммита a49035a (11.11) API требует оба поля, и «Работа» появилась на боевом только с релизом 55, где это требование
-- уже было, — строк «Работа» без графика или опыта нет. Совместимо с кодом прошлого релиза (55, 56): он всегда ставит
-- оба поля; код до релиза 55 «Работу» не создавал.
-- Проверка та же по имени, правило строже: у JOB оба поля есть, у остальных — ни одного.
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE "Vacancy" DROP CONSTRAINT "Vacancy_job_terms_check";
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_job_terms_check" CHECK (
  ("kind" = 'JOB' AND "schedule" IS NOT NULL AND "experience" IS NOT NULL)
  OR ("kind" <> 'JOB' AND "schedule" IS NULL AND "experience" IS NULL)
);

COMMIT;
