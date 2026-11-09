-- One-time data migration (2026-11-09): the Universities menu item moves right after "How it works". No schema change.
--
-- The menu then reads: Courses, Teachers, Subscription, My set, How it works, Universities, For centers, FAQ.
-- Only the item added by 20261106000000_university_preparation_navigation (id 'n-universities') is moved, and only when the
-- menu has a "How it works" item (id 'n-how'); its label, link and on/off state stay as they are. Nothing is added or
-- removed, and no other setting, user, subscription, payment, enrollment, course or group is touched.
-- Safety: the stored menu and version are written to "AuditEvent" (action 'content.sync', id
-- 'navigation-order-20261109-SiteConfig') before the change; the step runs in its own sub-transaction, so a failure is
-- rolled back and reported without failing the migration. A database without the ILMORA catalog (tests, fresh installs)
-- is left untouched, and running it again changes nothing.
-- Undo: set "SiteConfig".data->'nav' back to the "before" value of that audit row.

DO $sync$
DECLARE
  t text;
  nav jsonb;
  item jsonb;
  how_pos integer;
  uni_pos integer;
  moved jsonb;
BEGIN
  SELECT "tenantId" INTO t FROM "Course" WHERE "id" = 'c-general-english' AND "deletedAt" IS NULL;
  IF t IS NULL THEN
    RAISE NOTICE 'navigation order: no ILMORA catalog in this database, nothing to do';
    RETURN;
  END IF;
  SELECT "data"->'nav' INTO nav FROM "SiteConfig" WHERE "tenantId" = t;
  IF nav IS NULL OR jsonb_typeof(nav) <> 'array' THEN
    RAISE NOTICE 'navigation order: no menu in the site settings, nothing to do';
    RETURN;
  END IF;
  SELECT x.i, x.v INTO uni_pos, item FROM jsonb_array_elements(nav) WITH ORDINALITY AS x(v, i) WHERE x.v->>'id' = 'n-universities';
  SELECT x.i INTO how_pos FROM jsonb_array_elements(nav) WITH ORDINALITY AS x(v, i) WHERE x.v->>'id' = 'n-how';
  IF uni_pos IS NULL OR how_pos IS NULL THEN
    RAISE NOTICE 'navigation order: no Universities or How it works item, nothing to do';
    RETURN;
  END IF;
  IF uni_pos = how_pos + 1 THEN
    RAISE NOTICE 'navigation order: Universities already follows How it works, nothing to do';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO "AuditEvent" ("id", "tenantId", "action", "entityType", "entityId", "before", "after", "reason")
    SELECT 'navigation-order-20261109-SiteConfig', t, 'content.sync', 'SiteConfig', t,
      jsonb_build_object('version', "version", 'nav', "data"->'nav'),
      jsonb_build_object('movedNavItem', 'n-universities', 'after', 'n-how'),
      'University Preparation: Universities menu item moved after How it works'
    FROM "SiteConfig" WHERE "tenantId" = t
    ON CONFLICT ("id") DO NOTHING;
    SELECT jsonb_agg(q.v ORDER BY q.ord) INTO moved FROM (
      SELECT x.v, x.i::numeric AS ord FROM jsonb_array_elements(nav) WITH ORDINALITY AS x(v, i) WHERE x.v->>'id' <> 'n-universities'
      UNION ALL SELECT item, how_pos + 0.5
    ) AS q;
    UPDATE "SiteConfig" SET "data" = jsonb_set("data", '{nav}', moved), "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "tenantId" = t;
    RAISE NOTICE 'navigation order: Universities moved after How it works';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'navigation order failed and was rolled back: %', SQLERRM;
  END;
END
$sync$;
