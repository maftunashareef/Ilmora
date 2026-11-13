-- Журнал аудита: строки нельзя править и удалять — теперь это держит база (ТЗ 8; docs/security.md, БЗ-10.4; ТЗ «Студенты
-- у компании», раздел 7), и индекс для чтения журнала по компании (GET admin/audit?companyId=…).
--
-- 1. Триггеры "AuditEvent_append_only" (BEFORE UPDATE OR DELETE, на строку) и "AuditEvent_no_truncate" (BEFORE TRUNCATE)
--    отклоняют операцию. INSERT не затронут: API, CLI и миграции пишут в журнал как раньше. Пропускаются два случая:
--    а) удалён аккаунт актора: связь "AuditEvent_actorId_fkey" ON DELETE SET NULL сама обнуляет "actorId". Такое
--       обновление проходит, только если меняется одно поле "actorId" (на NULL) и пользователя с прежним id уже нет, —
--       обычным UPDATE актора из записи не убрать;
--    б) обслуживание: в транзакции выставлено SET LOCAL ilmora.audit_maintenance = 'on'. Его ставит только команда
--       очистки демо-данных (src/cli/purge-demo.ts: удаляет записи о демо-строках и снимает демо-актора с остальных).
--       Настройка действует до конца транзакции; в коде API её нет. Это защита от ошибки в коде и от правки через
--       ORM, а не от того, кто выполняет в базе произвольный SQL под ролью приложения.
--    Функция и триггеры в schema.prisma не описываются (Prisma их не знает) — там комментарий у модели AuditEvent.
-- 2. Индекс "AuditEvent_tenantId_after_companyId_createdAt_idx" по ("tenantId", "after"->>'companyId', "createdAt"),
--    частичный — только строки, где компания записана (contact.*, students.page.view, student.card.view). Обычный
--    CREATE INDEX в этой транзакции, не CONCURRENTLY: журнал невелик (платформа работает с октября 2026), индекс
--    строится за доли секунды; на это время запись в журнал ждёт (чтение — нет), а CREATE TRIGGER в этой же миграции
--    всё равно берёт на таблицу блокировку от записи. CONCURRENTLY потребовал бы второй миграции без транзакции и при
--    сбое оставил бы недействительный индекс, который убирают руками.
--
-- Совместимо с кодом прошлого релиза: API журнал только дополняет (INSERT) и читает; строк не правит и не удаляет.
-- Полное удаление аккаунта (cleanup-accounts, тесты) идёт через случай (а). Не работает со старым кодом одно: команда
-- purge-demo из образа прошлого релиза — база откажет, её транзакция откатится целиком, данные не пострадают; запускать
-- её из образа этого релиза или новее. Граница отката API не меняется.
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE FUNCTION "AuditEvent_refuse_change"() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN
  IF current_setting('ilmora.audit_maintenance', true) = 'on' THEN
    IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."actorId" IS NOT NULL AND NEW."actorId" IS NULL
       AND (to_jsonb(NEW) - 'actorId') = (to_jsonb(OLD) - 'actorId')
       AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = OLD."actorId") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'The audit log is append-only: % on "AuditEvent" is refused', TG_OP
    USING HINT = 'Rows are added, never changed or removed (migration 20261125000100).';
END $fn$;

CREATE TRIGGER "AuditEvent_append_only" BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "AuditEvent_refuse_change"();
CREATE TRIGGER "AuditEvent_no_truncate" BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "AuditEvent_refuse_change"();

CREATE INDEX "AuditEvent_tenantId_after_companyId_createdAt_idx" ON "AuditEvent" ("tenantId", (("after"->>'companyId')), "createdAt")
  WHERE ("after"->>'companyId') IS NOT NULL;

COMMIT;
