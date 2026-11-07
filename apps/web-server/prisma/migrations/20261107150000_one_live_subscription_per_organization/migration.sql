-- ONE LIVE ORGANIZATION-WIDE SUBSCRIPTION PER ORGANIZATION (#105, D3 and D4).
--
-- Entitlements are the union of every subscription in force, so two live rows
-- quietly add up, and a workspace row entitles that workspace on top of the
-- organization's plan. Billing needs one answer per organization. In order:
--   1. fold workspace rows into the organization (D3), so no workspace loses access;
--   2. end the live rows that entitle nothing (canceled without an end, archived plan);
--   3. refuse to go on if any organization still has two live organization-wide rows;
--   4. add `liveOrganizationId`, unique, set on the one live organization-wide row.

-- ONE TRANSACTION: step 3 refuses on purpose, and a refusal must leave the
-- database exactly as it was, not with the column added and half the fold done.
BEGIN;

ALTER TABLE "perm_subscription" ADD COLUMN "liveOrganizationId" TEXT;

-- ── 1. the fold ─────────────────────────────────────────────────────────────
-- Candidates: live rows that entitle now (active, not ended, plan not archived,
-- access ahead or open-ended), for organizations with a live workspace row or
-- with more than one live organization-wide row. Nothing else is touched.
CREATE TEMP TABLE fold_candidate AS
SELECT s.*
FROM "perm_subscription" s
JOIN "perm_plan" p ON p."key" = s."planKey"
WHERE s."status" = 'active'
  AND s."endedAt" IS NULL
  AND p."archivedAt" IS NULL
  AND (s."accessUntil" IS NULL OR s."accessUntil" > (now() AT TIME ZONE 'UTC'))
  AND s."organizationId" IN (
    SELECT "organizationId" FROM "perm_subscription"
    WHERE "status" = 'active' AND "endedAt" IS NULL
    GROUP BY "organizationId"
    HAVING COUNT(*) FILTER (WHERE "workspaceId" IS NOT NULL) > 0
        OR COUNT(*) FILTER (WHERE "workspaceId" IS NULL) > 1
  );

-- A plan COVERS another when it has every feature of it and every cap at least
-- as large (a cap it does not set is the floor of 1) — `planCovers` in
-- module-platform-billing. The winner per organization covers every other
-- candidate; the organization's own row first when it does, then the latest end.
CREATE TEMP TABLE fold_winner AS
SELECT DISTINCT ON (c."organizationId") c.*
FROM fold_candidate c
WHERE NOT EXISTS (
  SELECT 1 FROM fold_candidate o
  WHERE o."organizationId" = c."organizationId"
    AND (
      EXISTS (
        SELECT 1 FROM "perm_plan_feature" fo
        WHERE fo."planKey" = o."planKey"
          AND NOT EXISTS (
            SELECT 1 FROM "perm_plan_feature" fc WHERE fc."planKey" = c."planKey" AND fc."featureKey" = fo."featureKey"
          )
      )
      OR EXISTS (
        SELECT 1 FROM "perm_plan_limit" lo
        WHERE lo."planKey" = o."planKey"
          AND COALESCE(
            (SELECT lc."value" FROM "perm_plan_limit" lc WHERE lc."planKey" = c."planKey" AND lc."limitKey" = lo."limitKey"),
            1
          ) < lo."value"
      )
    )
)
ORDER BY c."organizationId", (c."workspaceId" IS NULL) DESC, c."currentPeriodEnd" DESC NULLS FIRST, c."id";

-- An organization where no plan covers the others is NOT guessed at: its rows
-- stay as they are and it is named here. An operator makes a private plan
-- holding the union on /admin/plans, assigns it, and runs the step again
-- (PLATFORM-BILLING-PLAN D3). Step 3 stops the migration if leaving it would
-- break the one-live-row rule.
DO $$
DECLARE skipped TEXT;
BEGIN
  SELECT string_agg(DISTINCT c."organizationId", ', ') INTO skipped
  FROM fold_candidate c
  WHERE NOT EXISTS (SELECT 1 FROM fold_winner w WHERE w."organizationId" = c."organizationId");
  IF skipped IS NOT NULL THEN
    RAISE NOTICE 'Fold skipped, no plan covers the others: %', skipped;
  END IF;
END $$;

-- A workspace row won: the organization gets a NEW organization-wide row with
-- its plan and the latest period and access among the candidates. The workspace
-- row is never retargeted: the write service keeps a target immutable, so what
-- it entitled in the past still reads true.
INSERT INTO "perm_subscription"
  ("id", "organizationId", "workspaceId", "planKey", "status", "currentPeriodEnd", "periodStart", "billingDay", "accessUntil", "endedAt")
SELECT
  'fold_' || md5(w."id" || clock_timestamp()::text),
  w."organizationId",
  NULL,
  w."planKey",
  'active',
  (SELECT MAX(c."currentPeriodEnd") FROM fold_candidate c WHERE c."organizationId" = w."organizationId"),
  w."periodStart",
  w."billingDay",
  CASE
    WHEN EXISTS (SELECT 1 FROM fold_candidate c WHERE c."organizationId" = w."organizationId" AND c."accessUntil" IS NULL) THEN NULL
    ELSE (SELECT MAX(c."accessUntil") FROM fold_candidate c WHERE c."organizationId" = w."organizationId")
  END,
  NULL
FROM fold_winner w
WHERE w."workspaceId" IS NOT NULL;

-- Every other live row of a folded organization ends, kept as history: its
-- workspace rows (the winning one too, now that a new row carries its plan),
-- and the organization-wide rows the winner covers. Only the winner survives,
-- and only when it is the organization's own row.
UPDATE "perm_subscription" s
SET "endedAt" = (now() AT TIME ZONE 'UTC'), "status" = 'canceled'
FROM fold_winner w
WHERE s."organizationId" = w."organizationId"
  AND s."endedAt" IS NULL
  AND s."id" NOT LIKE 'fold\_%'
  AND (s."id" <> w."id" OR w."workspaceId" IS NOT NULL);

-- ── 2. live rows that entitle nothing ───────────────────────────────────────
-- Canceled or past due without an end, or on an archived plan: they entitle
-- nothing today, and left open they would hold the one live slot. A row whose
-- access merely expired stays open: it is what lets a refusal say when the
-- plan ended, and billing ends it when the organization renews.
UPDATE "perm_subscription" s
SET "endedAt" = (now() AT TIME ZONE 'UTC'), "status" = 'canceled'
FROM "perm_plan" p
WHERE p."key" = s."planKey"
  AND s."endedAt" IS NULL
  AND (s."status" <> 'active' OR p."archivedAt" IS NOT NULL);

-- ── 3. refuse rather than guess ─────────────────────────────────────────────
DO $$
DECLARE crowded TEXT;
BEGIN
  SELECT string_agg("organizationId", ', ') INTO crowded FROM (
    SELECT "organizationId" FROM "perm_subscription"
    WHERE "endedAt" IS NULL AND "workspaceId" IS NULL
    GROUP BY "organizationId" HAVING COUNT(*) > 1
  ) x;
  IF crowded IS NOT NULL THEN
    RAISE EXCEPTION 'These organizations still have more than one live organization-wide subscription: %. Make a plan covering them on /admin/plans, end the others, and run the migration again (#105).', crowded;
  END IF;
END $$;

-- ── 4. the constraint ───────────────────────────────────────────────────────
UPDATE "perm_subscription"
SET "liveOrganizationId" = "organizationId"
WHERE "endedAt" IS NULL AND "workspaceId" IS NULL;

CREATE UNIQUE INDEX "perm_subscription_liveOrganizationId_key" ON "perm_subscription"("liveOrganizationId");

DROP TABLE fold_candidate;
DROP TABLE fold_winner;

COMMIT;
