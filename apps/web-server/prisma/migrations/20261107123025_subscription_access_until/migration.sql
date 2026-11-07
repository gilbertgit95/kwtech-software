-- AlterTable
ALTER TABLE "perm_subscription" ADD COLUMN     "accessUntil" TIMESTAMP(3),
ADD COLUMN     "billingDay" INTEGER,
ADD COLUMN     "periodStart" TIMESTAMP(3);

-- ⚠ THE RELEASE STEP (issue #92, PLATFORM-BILLING-PLAN §5).
--
-- From this release the entitlement read compares `accessUntil` with now.
-- Until now nothing compared `currentPeriodEnd` with anything, so live rows
-- carry period ends that are empty, or already past while still entitling (the
-- local database had one). Without this step the first request after deploy
-- would expire them all at once.
--
-- Every live row (active, not ended, organization-wide or workspace) is given
-- a period end at least 30 days after release, keeping a later one it already
-- has, and access until 7 grace days after that: the default grace billing
-- uses (DEFAULT_GRACE_DAYS). Owners are told by billing's notices once phase
-- 5b exists; until then the date shows on the organization screens.
--
-- Columns are TIMESTAMP(3) holding UTC, as `currentPeriodEnd` always has, so
-- now() is read in UTC rather than the session's zone.
UPDATE "perm_subscription"
SET "currentPeriodEnd" = GREATEST(
      COALESCE("currentPeriodEnd", (now() AT TIME ZONE 'UTC') + INTERVAL '30 days'),
      (now() AT TIME ZONE 'UTC') + INTERVAL '30 days'
    )
WHERE "status" = 'active' AND "endedAt" IS NULL;

UPDATE "perm_subscription"
SET "accessUntil" = "currentPeriodEnd" + INTERVAL '7 days',
    "periodStart" = "currentPeriodEnd" - INTERVAL '1 month',
    -- The billing day in the platform zone (Asia/Manila, DEFAULT_TIME_ZONE).
    "billingDay" = EXTRACT(DAY FROM ("currentPeriodEnd" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::INTEGER
WHERE "status" = 'active' AND "endedAt" IS NULL;
