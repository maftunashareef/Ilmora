-- Тип у центра (задача директора, Нозим 13.11): студент ищет курс конкретного учебного заведения — на странице
-- «Центры» поиск и деление на вузы, колледжи и техникумы, школы и лицеи, учебные центры. Типы — те же, что у реестра
-- (InstitutionType): одно перечисление на всю базу.
-- Все центры — учебные центры по умолчанию; поменяют сами или Super Admin. Центр, привязанный к записи реестра
-- (Institution.centerId, уникален), получает её тип. Демо-центры (у названия «(demo)») — разные типы, чтобы вкладки
-- было видно на сайте; при запуске их удаляют вместе с демо-данными.
-- Совместимо с кодом прошлого релиза: новая колонка с умолчанием, старый код её не читает.
-- One transaction with a lock timeout (security review 11.11, №87 and №122; docs/migrations.md).
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE "Center" ADD COLUMN "kind" "InstitutionType" NOT NULL DEFAULT 'TRAINING_CENTER';

UPDATE "Center" c SET "kind" = i."type"
FROM "Institution" i
WHERE i."centerId" = c."id";

UPDATE "Center" c SET "kind" = d.kind::"InstitutionType"
FROM (VALUES
  ('ce-tafakkur', 'LYCEUM'), ('ce-chilonzor', 'COLLEGE'), ('ce-nova', 'SCHOOL'),
  ('ce-mezon', 'UNIVERSITY'), ('ce-ustoz', 'TECHNIKUM')
) AS d(id, kind)
WHERE c."id" = d.id AND c."name" LIKE '%(demo)%'
  AND NOT EXISTS (SELECT 1 FROM "Institution" i WHERE i."centerId" = c."id");

CREATE INDEX "Center_tenantId_kind_idx" ON "Center"("tenantId", "kind");

COMMIT;
