-- One-time data migration (2026-11-06): University Preparation in the site menu and on the homepage. No schema change.
--
-- Adds, only when missing, to the ILMORA site settings (as packages/shared/src/sample-data.ts has them):
--   * the menu item "Universitetlar / Университеты / Universities" (/universities) as the first item, unless an item for
--     /universities exists already (also when an admin switched it off) or the menu is full (12 items);
--   * the homepage section "University preparation" right after the special offers (after the hero when there are none),
--     unless the homepage has a universities section already.
-- Append-only: nothing is removed, reordered or rewritten; no other setting, user, subscription, payment, enrollment,
-- course or group is touched.
-- Safety: the stored menu, homepage and version are written to "AuditEvent" (action 'content.sync', id
-- 'navigation-sync-20261106-SiteConfig') before the change; the step runs in its own sub-transaction, so a failure is
-- rolled back and reported without failing the migration. A database without the ILMORA catalog (tests, fresh installs)
-- is left untouched, and running it again adds nothing.
-- Undo: set "SiteConfig".data->'nav' and ->'pages'->'home' back to the "before" values of that audit row.

DO $sync$
DECLARE
  t text;
  nav_item jsonb := $nav${"id":"n-universities","label":{"uz":"Universitetlar","ru":"Университеты","en":"Universities"},"path":"/universities","enabled":true}$nav$::jsonb;
  section jsonb := $sec${"id":"h-universities","type":"universities","enabled":true,"title":{"uz":"Universitetga tayyorgarlik","ru":"Подготовка к поступлению","en":"University preparation"},"subtitle":{"uz":"Universitet va yönalişni tanlang: kiriş fanlari böyiça kurslar bitta paketda.","ru":"Выберите университет и направление: курсы по вступительным предметам — в одном пакете.","en":"Choose a university and direction: the courses for its entrance subjects come as one package."}}$sec$::jsonb;
  nav jsonb;
  home jsonb;
  pos numeric;
  add_nav boolean;
  add_section boolean;
BEGIN
  SELECT "tenantId" INTO t FROM "Course" WHERE "id" = 'c-general-english' AND "deletedAt" IS NULL;
  IF t IS NULL THEN
    RAISE NOTICE 'navigation sync: no ILMORA catalog in this database, nothing to do';
    RETURN;
  END IF;
  SELECT "data"->'nav', "data"->'pages'->'home' INTO nav, home FROM "SiteConfig" WHERE "tenantId" = t;
  IF nav IS NULL OR jsonb_typeof(nav) <> 'array' OR home IS NULL OR jsonb_typeof(home) <> 'array' THEN
    RAISE NOTICE 'navigation sync: no site settings with a menu and a homepage, nothing to do';
    RETURN;
  END IF;
  add_nav := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(nav) AS x(v) WHERE x.v->>'path' = '/universities' OR x.v->>'id' = 'n-universities');
  IF add_nav AND jsonb_array_length(nav) >= 12 THEN
    add_nav := false;
    RAISE NOTICE 'navigation sync: the menu already has 12 items, the universities item is not added';
  END IF;
  add_section := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(home) AS x(v) WHERE x.v->>'type' = 'universities' OR x.v->>'id' = 'h-universities');
  IF NOT add_nav AND NOT add_section THEN
    RAISE NOTICE 'navigation sync: menu item and homepage section already present, nothing to do';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO "AuditEvent" ("id", "tenantId", "action", "entityType", "entityId", "before", "after", "reason")
    SELECT 'navigation-sync-20261106-SiteConfig', t, 'content.sync', 'SiteConfig', t,
      jsonb_build_object('version', "version", 'nav', "data"->'nav', 'home', "data"->'pages'->'home'),
      jsonb_build_object('addedNavItem', add_nav, 'addedHomeSection', add_section),
      'University Preparation: menu item and homepage section added'
    FROM "SiteConfig" WHERE "tenantId" = t
    ON CONFLICT ("id") DO NOTHING;
    IF add_nav THEN
      nav := jsonb_build_array(nav_item) || nav;
    END IF;
    IF add_section THEN
      -- right after the special offers, or after the hero when there are none, or first
      SELECT min(x.i) INTO pos FROM jsonb_array_elements(home) WITH ORDINALITY AS x(v, i) WHERE x.v->>'type' = 'discounts';
      IF pos IS NULL THEN
        SELECT min(x.i) INTO pos FROM jsonb_array_elements(home) WITH ORDINALITY AS x(v, i) WHERE x.v->>'type' = 'hero';
      END IF;
      SELECT jsonb_agg(q.v ORDER BY q.ord) INTO home FROM (
        SELECT x.v, x.i::numeric AS ord FROM jsonb_array_elements(home) WITH ORDINALITY AS x(v, i)
        UNION ALL SELECT section, COALESCE(pos, 0) + 0.5
      ) AS q;
    END IF;
    UPDATE "SiteConfig" SET "data" = jsonb_set(jsonb_set("data", '{nav}', nav), '{pages,home}', home), "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "tenantId" = t;
    RAISE NOTICE 'navigation sync: menu item added: %, homepage section added: %', add_nav, add_section;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'navigation sync failed and was rolled back: %', SQLERRM;
  END;
END
$sync$;
