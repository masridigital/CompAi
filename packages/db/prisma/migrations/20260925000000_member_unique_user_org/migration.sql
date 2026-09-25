-- S4: one Member row per (userId, organizationId), plus a real FK for
-- Session.activeOrganizationId.
--
-- Existing duplicates are merged before the unique index is created:
--   1. Per (userId, organizationId) keep ONE row: active + not deactivated
--      first, then the most recently created (id breaks ties).
--   2. Merge role strings into the kept row. Roles from inactive/deactivated
--      duplicates are only merged when the kept row itself is inactive, so an
--      old deactivated 'owner' row cannot escalate an active membership.
--   3. Repoint every column that references a duplicate to the kept row: all
--      single-column FKs to "Member"(id) (discovered from pg_constraint, so no
--      table is missed) and the plain-id ISMS columns that have no FK. When the
--      kept member already has the equivalent row (unique conflict, e.g. the
--      same training video completion), the duplicate's row is dropped.
--   4. Delete the duplicates.

-- 1. duplicate -> kept mapping
CREATE TEMP TABLE "_member_dedupe" AS
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER w AS rn,
    FIRST_VALUE("id") OVER w AS keep_id
  FROM "Member"
  WINDOW w AS (
    PARTITION BY "userId", "organizationId"
    ORDER BY ("isActive" AND NOT "deactivated") DESC, "createdAt" DESC, "id" DESC
  )
)
SELECT "id" AS dup_id, keep_id FROM ranked WHERE rn > 1;

-- 2. merge roles into the kept row
WITH groups AS (
  SELECT DISTINCT keep_id, keep_id AS member_id FROM "_member_dedupe"
  UNION
  SELECT keep_id, dup_id AS member_id FROM "_member_dedupe"
),
eligible AS (
  SELECT g.keep_id, m."role", m."id" = g.keep_id AS is_kept
  FROM groups g
  JOIN "Member" m ON m."id" = g.member_id
  JOIN "Member" k ON k."id" = g.keep_id
  WHERE m."id" = g.keep_id
     OR (m."isActive" AND NOT m."deactivated")
     OR NOT (k."isActive" AND NOT k."deactivated")
),
merged AS (
  SELECT keep_id, string_agg(DISTINCT btrim(r), ',') AS "role"
  FROM eligible
  CROSS JOIN LATERAL unnest(string_to_array(eligible."role", ',')) AS r
  WHERE btrim(r) <> ''
  GROUP BY keep_id
)
UPDATE "Member" k
SET "role" = merged."role"
FROM merged
WHERE k."id" = merged.keep_id;

-- 3. repoint references
DO $$
DECLARE
  ref RECORD;
  row_ref RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "_member_dedupe") THEN
    RETURN;
  END IF;

  FOR ref IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname::text AS col
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = '"Member"'::regclass
      AND array_length(c.conkey, 1) = 1
    UNION
    SELECT format('%I', t.tbl), t.col
    FROM (VALUES
      ('IsmsObjective', 'ownerMemberId'),
      ('IsmsRole', 'auditRouteMemberId'),
      ('IsmsRoleAssignment', 'memberId'),
      ('IsmsMetric', 'monitorMemberId'),
      ('IsmsMetric', 'analyzeMemberId'),
      ('IsmsMeasurement', 'enteredById'),
      ('IsmsAuditFinding', 'ownerMemberId'),
      ('IsmsReviewAction', 'ownerMemberId')
    ) AS t(tbl, col)
    JOIN information_schema.columns ic
      ON ic.table_schema = current_schema()
     AND ic.table_name = t.tbl
     AND ic.column_name = t.col
  LOOP
    FOR row_ref IN EXECUTE format(
      'SELECT t.ctid AS rid, d.keep_id FROM %s t JOIN "_member_dedupe" d ON t.%I = d.dup_id',
      ref.tbl, ref.col
    )
    LOOP
      BEGIN
        EXECUTE format('UPDATE %s SET %I = $1 WHERE ctid = $2', ref.tbl, ref.col)
          USING row_ref.keep_id, row_ref.rid;
      EXCEPTION WHEN unique_violation THEN
        EXECUTE format('DELETE FROM %s WHERE ctid = $1', ref.tbl)
          USING row_ref.rid;
      END;
    END LOOP;
  END LOOP;
END $$;

-- 4. drop the duplicates
DELETE FROM "Member" m
USING "_member_dedupe" d
WHERE m."id" = d.dup_id;

DROP TABLE "_member_dedupe";

-- CreateIndex
CREATE UNIQUE INDEX "Member_userId_organizationId_key" ON "Member"("userId", "organizationId");

-- Session.activeOrganizationId: clear orphans, then enforce the FK.
UPDATE "Session" s
SET "activeOrganizationId" = NULL
WHERE s."activeOrganizationId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Organization" o WHERE o."id" = s."activeOrganizationId"
  );

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_activeOrganizationId_fkey" FOREIGN KEY ("activeOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
