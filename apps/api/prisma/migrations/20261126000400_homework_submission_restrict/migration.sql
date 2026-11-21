-- Проверка безопасности ILMORA 20.11, №8 (Нозим, 21.11): сдачи ДЗ не стираются вместе с заданием. Было ON DELETE CASCADE:
-- между проверкой «сдач нет» и удалением задания могла прийти сдача — и пропасть вместе с ним. Теперь база сама не даёт
-- удалить задание, у которого есть сдачи (RESTRICT); сервис отвечает на это 409 `homework_has_submissions`.
-- Продления (HomeworkExtension) остаются каскадными: задание, которое никто не сдал, учитель удаляет вместе со своими
-- продлениями (тест classroom-security, «extension alone is not RESTRICT»).
-- Совместимо с кодом прошлого релиза: он удаляет задание только без сдач (проверяет перед удалением) — это проходит.
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE "HomeworkSubmission" DROP CONSTRAINT "HomeworkSubmission_homeworkId_fkey";
ALTER TABLE "HomeworkSubmission" ADD CONSTRAINT "HomeworkSubmission_homeworkId_fkey" FOREIGN KEY ("homeworkId") REFERENCES "Homework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
