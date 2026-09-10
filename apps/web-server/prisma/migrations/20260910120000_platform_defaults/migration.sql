-- ─────────────────────────────────────────────────────────────────────────────
-- The platform's defaults: what a new account, organization and workspace get.
--
-- A key/value table rather than a column each, because the four values point at
-- four different things — an app role, an organization role, a plan, a
-- workspace role — and a typed column per default would mean a migration every
-- time the platform gained one. What each key MEANS lives in the code
-- catalogue (`defaults.ts`); this holds only what it is SET to.
--
-- No rows are inserted here. Every default starts UNSET, which is exactly the
-- behaviour that exists today: an organization's founder holds no role, a new
-- organization is on no plan, and the app-level role for a new account keeps
-- coming from `defaultAppRoleKey` in the module options until somebody sets one
-- on the screen. A migration that seeded a policy would be this table deciding
-- for every existing deployment what its founders hold, which is the one thing
-- it must not do.
CREATE TABLE "perm_default" (
    "key" TEXT NOT NULL,
    -- Nullable, and a NULL row is not the same as a missing one: both mean "no
    -- default", but the row is what lets updatedByUserId record who turned it off.
    "value" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    -- A plain id, no foreign key: perm_* never references the auth module's
    -- tables (§12.12), so an account can be deleted and this still says which
    -- id made the decision.
    "updatedByUserId" TEXT,

    CONSTRAINT "perm_default_pkey" PRIMARY KEY ("key")
);
