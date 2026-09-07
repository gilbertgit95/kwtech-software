import { canPlanEntitle, FEATURE, LIMIT, type PlanDefinition } from '@kwtech/module-permissions';
import { ALL_FEATURES } from './registry.js';

/**
 * The plan catalogue THIS product starts with.
 *
 * Deliberately app-side, where the mechanics that write them are not — the same
 * division as `app-roles.ts`. Which products a platform sells is a product
 * decision: a second app composing `@kwtech/module-permissions` would want
 * different tiers, and the module upserting a plan called `pro` into every
 * database that ever adopted it would be the module deciding something that is
 * not its.
 *
 * ⚠ A STARTING POINT, NOT A SPECIFICATION. `createPlanIfAbsent` creates a plan
 * that is missing and leaves an existing one alone, so editing this file does
 * NOT change an environment that already has these rows. That is the intended
 * trade — what a plan sells is meant to be changed through the admin screens
 * without a deploy — but it means the file and a live catalogue drift apart the
 * moment anybody uses those screens. Read the database, not this file, to learn
 * what a customer is actually entitled to.
 *
 * ## Why the billing keys are in EVERY tier, including free
 *
 * `billing:manage`, `plans:read` and `subscriptions:read` are all
 * organization-level, so they pass through the entitlement filter like anything
 * else. A plan that omitted them would produce a customer who cannot open the
 * screen that would let them upgrade — locked out of paying you by the free
 * tier. Every tier sells them, and any new tier must too.
 */

/*
 * ── the tier badges ─────────────────────────────────────────────────────────
 *
 * A ladder a reader can order without being told: a sprout, a rocket, a bolt, a
 * gem. Chosen so the sequence is legible at a glance in a catalogue, which is
 * the only job a tier badge has.
 *
 * `sprout` is shared with the `normal-user` role on purpose — both mean
 * "starting from nothing", one about a person and one about a plan. Icon names
 * are a shared vocabulary (see the app's ICONS map), not a per-table one.
 *
 * They carry NO commercial meaning. A plan is exactly the features and caps it
 * holds; `assertPlanFeatureLevels` ignores the icon and nothing branches on it.
 * Swapping `gem` for `trophy` changes the drawing and nothing else.
 */

/**
 * Read-only sight of the access-control vocabulary.
 *
 * Held by every tier: seeing which roles exist and what a feature means is how
 * an administrator understands their own organization, and withholding it makes
 * the free tier confusing rather than limited. What free actually lacks is the
 * ability to CHANGE anything — those keys are app-level or absent below.
 */
const READ_ONLY_ADMIN = [FEATURE.featuresRead, FEATURE.rolesRead];

/**
 * The billing area. In every tier — see the note above.
 *
 * `billing:manage` is the write key: start, change or end a subscription. A
 * customer needs it to upgrade themselves, which is the one thing no tier may
 * withhold.
 */
const OWN_BILLING = [FEATURE.plansRead, FEATURE.subscriptionsRead, FEATURE.billingManage];

/**
 * Free — one workspace, a couple of people, nothing to administer.
 *
 * The caps are the product, not the features: a free organization can see how
 * the system works and cannot grow inside it. `members:manage` is withheld, so
 * the founder is the only member — which makes three seats generous rather than
 * restrictive, and is why the cap sits above one.
 */
const FREE: PlanDefinition = {
  key: 'free',
  label: 'Free',
  isPublic: true,
  icon: 'sprout',
  features: [...READ_ONLY_ADMIN, ...OWN_BILLING],
  limits: {
    [LIMIT.organizationMembers]: 3,
    [LIMIT.organizationWorkspaces]: 1,
    [LIMIT.workspaceMembers]: 3,
  },
};

/**
 * Starter — a small team that actually works together.
 *
 * The first tier that can INVITE and ORGANISE: members, workspaces, and sharing
 * a workspace with a colleague. That is the jump people pay for, and it is why
 * the free tier withholds exactly these three rather than something cosmetic.
 */
const STARTER: PlanDefinition = {
  key: 'starter',
  label: 'Starter',
  isPublic: true,
  icon: 'rocket',
  features: [
    ...READ_ONLY_ADMIN,
    ...OWN_BILLING,
    FEATURE.membersManage,
    FEATURE.workspacesManage,
    FEATURE.workspacesShare,
  ],
  limits: {
    [LIMIT.organizationMembers]: 10,
    [LIMIT.organizationWorkspaces]: 3,
    [LIMIT.workspaceMembers]: 10,
  },
};

/**
 * Pro — a company with more workspaces than any one person joins.
 *
 * Sells the same features as Starter and differs on CAPS: fifty seats,
 * twenty-five workspaces. That is honest rather than thin — the registry has
 * nine sellable keys today and they are all administrative, so there is nothing
 * product-shaped left to withhold from Starter that Pro could add.
 *
 * It used to add `workspaces:access_all`. That key was removed when workspace
 * membership became required (docs/PLAN.md §13, 2026-09-07): there is no longer
 * a right that lets somebody into a workspace they were not added to, so there
 * is nothing there to sell.
 */
const PRO: PlanDefinition = {
  key: 'pro',
  label: 'Pro',
  isPublic: true,
  icon: 'zap',
  features: [
    ...READ_ONLY_ADMIN,
    ...OWN_BILLING,
    FEATURE.membersManage,
    FEATURE.workspacesManage,
    FEATURE.workspacesShare,
  ],
  limits: {
    [LIMIT.organizationMembers]: 50,
    [LIMIT.organizationWorkspaces]: 25,
    [LIMIT.workspaceMembers]: 50,
  },
};

/**
 * Enterprise — everything a plan is capable of selling.
 *
 * DERIVED from the composed registry rather than listed, the same call
 * `super-admin` makes and for the same reason: a frozen list would leave the
 * tier named "Enterprise" while quietly ceasing to include everything, found
 * out as a denied request months later. A key added by ANY module — not just
 * this one — is sold by this tier on the next fresh seed.
 *
 * `canPlanEntitle` does the filtering, so app-level keys are excluded by the
 * same rule the plan editor and the write path use. There is no risk of selling
 * something inert — module-auth's three `account:*` keys are app level, so no
 * tier sells them and none may withhold them either: looking after your own
 * profile is not a billable feature.
 *
 * The caps are deliberately finite. "Unlimited" is not expressible —
 * `resolveLimits` takes a number or falls back to the registry floor — and a
 * large number is the honest way to say "more than anyone will reach", the same
 * device `super-admin`'s `user:organizations: 9999` uses.
 */
const ENTERPRISE: PlanDefinition = {
  key: 'enterprise',
  label: 'Enterprise',
  isPublic: true,
  icon: 'gem',
  features: ALL_FEATURES.filter((spec) => canPlanEntitle(spec.level)).map((spec) => spec.key),
  limits: {
    [LIMIT.organizationMembers]: 10_000,
    [LIMIT.organizationWorkspaces]: 1_000,
    [LIMIT.workspaceMembers]: 10_000,
  },
};

/**
 * Ordered cheapest first, which is the order the seeder logs them in and the
 * order a catalogue reads in. Nothing depends on it — plans have no ranking of
 * their own, because a plan is exactly the list of features it carries.
 */
export const PLANS: readonly PlanDefinition[] = [FREE, STARTER, PRO, ENTERPRISE];
