import { APP_HUB_FEATURE } from '@kwtech/module-app-hub';
import { BOOKS_FEATURE } from '@kwtech/module-basic-bookkeeping';
import { STOCK_FEATURE, STOCK_LIMIT } from '@kwtech/module-basic-inventory';
import { POS_FEATURE, POS_LIMIT } from '@kwtech/module-basic-pos';
import { BOOKING_FEATURE, BOOKING_LIMIT } from '@kwtech/module-booking';
import { NOTE_FEATURE, NOTE_LIMIT } from '@kwtech/module-note';
import { canPlanEntitle, FEATURE, LIMIT, type PlanDefinition } from '@kwtech/module-permissions';
import { PRINT_FEATURE, PRINT_LIMIT } from '@kwtech/module-print';
import { STUDIO_FEATURE, STUDIO_LIMIT } from '@kwtech/module-print-studio';
import { QUEUE_FEATURE, QUEUE_LIMIT } from '@kwtech/module-queuing-window';
import { TASK_FEATURE, TASK_LIMIT } from '@kwtech/module-task';
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
 * the free tier confusing rather than limited.
 */
const READ_ONLY_ADMIN = [FEATURE.rolesRead];

/**
 * The billing area. In every tier — see the note above.
 *
 * `billing:manage` is the write key: start, change or end a subscription. A
 * customer needs it to upgrade themselves, which is the one thing no tier may
 * withhold.
 */
const OWN_BILLING = [FEATURE.subscriptionsRead];

/**
 * The organization's own screens: opening it, and naming it.
 *
 * IN EVERY TIER, and this is the clearest case of the rule the group above
 * states. Being able to open the company you are a member of is not a feature
 * anybody sells — it is the floor. A plan that withheld `organization:read`
 * would produce a customer who signs in, sees their organization in the
 * switcher, and is refused by it, with the denial correctly reading
 * "not_entitled": their roles grant it and their plan does not. That is a
 * support ticket about billing for something nobody meant to charge for.
 *
 * `organization:manage` is here for the same reason. Renaming your own company
 * is not an upgrade path; the platform's ability to rename ANY tenant is a
 * different key entirely (`organizations:manage`, app level), and no plan may
 * carry that one — an app-level key in a plan entitles nobody, because
 * app-level grants skip the entitlement filter.
 *
 * ⚠ **Adding these did NOT change any plan that already exists.**
 * `createPlanIfAbsent` creates what is missing and never rewrites what is
 * there (§12.26), which is deliberate — the catalogue is the operator's. So a
 * database seeded before 2026-09-09 has a `free` plan without these keys, and
 * every tenant on it is refused their own organization until an operator adds
 * them on `/admin/plans`. Verified against the live database, where exactly
 * that happened.
 */
const OWN_ORGANIZATION = [FEATURE.organizationRead, FEATURE.organizationUpdate];

/**
 * Seeing who is here and which workspaces exist. In every tier: a tenant with
 * three seats can still see its own member list.
 */
const SEEING_AROUND = [FEATURE.membersRead, FEATURE.workspacesRead, FEATURE.workspaceRead];

/**
 * Working together: adding people, organising workspaces, and granting roles
 * inside one.
 *
 * IN EVERY TIER since issue #89, Free included. It used to be the jump the paid
 * tiers sold, which left Free unable to create the one workspace its cap
 * allowed: a new organization has none, so a free founder could use nothing.
 * The caps (members, workspaces) are what keep Free small now, not withholding
 * these.
 *
 * ⚠ The READS are deliberately NOT here, they are in `SEEING_AROUND` and every
 * tier has them. Before the split, `members:manage` bundled reading the roster
 * with changing it, so withholding the bundle from `free` also hid the member
 * list from a tenant with three seats — invisible while it was one key, and
 * plainly wrong once they were separate.
 */
const TEAMWORK = [
  FEATURE.membersInvite,
  FEATURE.membersRemove,
  FEATURE.membersAssignRole,
  FEATURE.workspacesCreate,
  FEATURE.workspacesUpdate,
  FEATURE.workspacesArchive,
  FEATURE.workspaceMembersAdd,
  FEATURE.workspaceMembersRemove,
  FEATURE.workspaceAssignRole,
];

/**
 * The walk-in queue, sold in every paid tier (PLAN §12.61, the operator's
 * answer).
 *
 * One named group, so the tiers cannot drift apart key by key. All six keys are
 * workspace level, so they pass the entitlement filter like the rest of a plan.
 *
 * ⚠ `createPlanIfAbsent` NEVER REWRITES A PLAN THAT EXISTS. Every environment
 * seeded before the queue shipped needs an operator to add these six keys, and
 * the two caps below, to Starter, Pro and Enterprise on `/admin/plans`. Until
 * then every queue surface answers `not_entitled`.
 */
const QUEUE = Object.values(QUEUE_FEATURE);

/**
 * The workspace's Apps page, in EVERY tier including free (APP-HUB-PLAN
 * decision 6): the page is free, and what it shows is gated by each app's own
 * keys. A tier without these would be refused the page that holds the apps it
 * DID buy.
 *
 * ⚠ `createPlanIfAbsent` NEVER REWRITES A PLAN THAT EXISTS. Every environment
 * seeded before the Apps page shipped needs an operator to add both keys to
 * every plan on `/admin/plans`; until then the page answers `not_entitled`.
 */
const APPS_PAGE = Object.values(APP_HUB_FEATURE);

/**
 * Notes, sold in EVERY tier, Free included since issue #89: a team can try the
 * app on notes and tasks, which handle no money. All three keys are workspace
 * level.
 *
 * ⚠ `createPlanIfAbsent` NEVER REWRITES A PLAN THAT EXISTS. An environment
 * seeded while notes were a placeholder has `note:read` only: an operator adds
 * `note:write` and `note:manage_all`, and the `note:notes` cap, on
 * `/admin/plans`. Until then people can open notes and write none, and the app
 * says so (not_entitled).
 */
const NOTES = Object.values(NOTE_FEATURE);

/**
 * Task boards, sold where notes are: every tier, Free included (issue #89).
 * All five keys are workspace level.
 *
 * ⚠ `createPlanIfAbsent` NEVER REWRITES A PLAN THAT EXISTS. An environment
 * seeded while tasks were a placeholder has `task:read` only: an operator adds
 * `task:write`, `task:create_boards`, `task:assign` and `task:manage_all`, and
 * the two caps, on `/admin/plans`. Until then people can open the app and do
 * nothing in it, and the app says so (not_entitled).
 */
const TASKS = Object.values(TASK_FEATURE);

/**
 * The point of sale, sold where it was as a placeholder: every tier except
 * free. All nine keys are workspace level.
 *
 * ⚠ `createPlanIfAbsent` NEVER REWRITES A PLAN THAT EXISTS. An environment
 * seeded while the POS was a placeholder has `pos:read` only: an operator adds
 * the other keys and the `pos:items` cap on `/admin/plans`. Until then
 * people can open the app and do nothing in it — the till says why.
 *
 * ⚠ `pos:take_payment` (issue #23, 2026-10-29) is the same case: a plan made
 * before it does not carry it, and NOBODY in that organization can take
 * payment — managers included — until an operator adds it to the plan.
 *
 * ⚠ `pos:set_availability` (issue #37, 2026-10-31) likewise: on a plan made
 * before it, nobody but a super admin can mark an item not available until an
 * operator adds the key on `/admin/plans`. The till hides the button meanwhile.
 */
const POS = Object.values(POS_FEATURE);

/**
 * The books, sold where the point of sale is: every paid tier. All three
 * keys are workspace level, and there is no cap.
 *
 * ⚠ `createPlanIfAbsent` NEVER REWRITES A PLAN THAT EXISTS: an environment
 * seeded before the books has none of these keys, and an operator adds them on
 * `/admin/plans`. Until then the app is not on the Apps page (not_entitled).
 */
const BOOKS = Object.values(BOOKS_FEATURE);

/**
 * Stock, sold where the point of sale is: every paid tier. All three
 * keys are workspace level.
 *
 * ⚠ `createPlanIfAbsent` NEVER REWRITES A PLAN THAT EXISTS: an environment
 * seeded before stock has none of these keys, and an operator adds them and the
 * `stock:items` cap on `/admin/plans`. Until then the app is not on the Apps
 * page (not_entitled), and the catch-up reaches no workspace.
 */
const STOCK = Object.values(STOCK_FEATURE);

/**
 * Booking, sold where the point of sale is: every paid tier. All five
 * keys are workspace level.
 *
 * ⚠ `createPlanIfAbsent` NEVER REWRITES A PLAN THAT EXISTS: an environment
 * seeded before booking has none of these keys, and an operator adds them and
 * the `booking:resources` cap on `/admin/plans`. Until then the app is not on
 * the Apps page (not_entitled), and its reminders reach no workspace.
 */
const BOOKING = Object.values(BOOKING_FEATURE);

/**
 * The print studio, sold where booking is: every paid tier. All three
 * keys are workspace level.
 *
 * ⚠ `createPlanIfAbsent` NEVER REWRITES A PLAN THAT EXISTS: an environment
 * seeded before the studio has none of these keys, and an operator adds them
 * and the `studio:layouts` cap on `/admin/plans`. Until then the app is not on
 * the Apps page (not_entitled), and its history is pruned in no workspace.
 */
const STUDIO = Object.values(STUDIO_FEATURE);

/**
 * Printing through a paired computer, sold where the print studio is: it is
 * the studio's way onto paper, so a plan with one and not the other would sell
 * half a feature. Both keys are workspace level.
 *
 * ⚠ The same `createPlanIfAbsent` caveat as the studio's: an environment
 * seeded before this has neither key, and an operator adds them and the
 * `print:agents` cap on `/admin/plans`. Until then the Printers app is not on
 * the Apps page (not_entitled).
 */
const PRINT = Object.values(PRINT_FEATURE);

/*
 * ── the tiers: by SIZE, not by sub-app (issue #89, PLAN §13 2026-11-07) ──────
 *
 * Every paid tier sells EVERY sub-app; the tiers differ by how big the business
 * is: branches (workspaces), people, and how much each sub-app holds. So the
 * upgrade question is always "have I outgrown my plan?".
 *
 * Bundles by kind of business (retail, services, print shop) were rejected:
 * every mix of businesses would need another plan, the same combination problem
 * as roles per sub-app (#25); moving between bundles is sideways, so a prorated
 * plan change (#88) has no natural direction; and the Apps page already hides
 * what a shop does not use.
 *
 * ⚠ THE NUMBERS ARE STARTING POINTS, and like everything here they reach only a
 * database that has no such plan yet (`createPlanIfAbsent`). An existing
 * environment changes its plans on `/admin/plans`, and what happens to an
 * organization already over a lowered cap is decided in #90 first.
 *
 * Units, from each module's limit registry: notes, task boards, tasks and
 * layouts count PER PERSON per workspace; everything else per workspace, except
 * the two `organization:*` caps.
 */

/** A sub-app cap set, one per tier, so no tier can quietly share another's numbers. */
interface AppCaps {
  queueWindows: number;
  queueDisplays: number;
  notes: number;
  taskBoards: number;
  tasks: number;
  posItems: number;
  stockItems: number;
  bookingResources: number;
  studioLayouts: number;
  printAgents: number;
}

/**
 * Turns a tier's numbers into plan limits.
 *
 * ⚠ Every field is required by `AppCaps`, so a tier cannot forget a sub-app's
 * cap: one left out would fall to the registry floor of 1, a shop allowed ONE
 * item for sale with nothing explaining why.
 */
function appLimits(caps: AppCaps): Record<string, number> {
  return {
    [QUEUE_LIMIT.windows]: caps.queueWindows,
    [QUEUE_LIMIT.displays]: caps.queueDisplays,
    [NOTE_LIMIT.notes]: caps.notes,
    [TASK_LIMIT.boards]: caps.taskBoards,
    [TASK_LIMIT.tasks]: caps.tasks,
    [POS_LIMIT.items]: caps.posItems,
    [STOCK_LIMIT.items]: caps.stockItems,
    [BOOKING_LIMIT.resources]: caps.bookingResources,
    [STUDIO_LIMIT.layouts]: caps.studioLayouts,
    [PRINT_LIMIT.agents]: caps.printAgents,
  };
}

/** What every tier holds, Free included: the floor described above each group. */
const EVERY_TIER = [
  ...OWN_ORGANIZATION,
  ...SEEING_AROUND,
  ...READ_ONLY_ADMIN,
  ...OWN_BILLING,
  ...TEAMWORK,
  ...APPS_PAGE,
];

/** Every sub-app. Each paid tier sells all of them; only the numbers differ. */
const EVERY_SUB_APP = [...QUEUE, ...NOTES, ...TASKS, ...POS, ...BOOKS, ...STOCK, ...BOOKING, ...STUDIO, ...PRINT];

/**
 * Free — trying the app with a small team: notes and tasks in one workspace.
 *
 * ⚠ IT USED TO WITHHOLD `TEAMWORK`, AND THAT MEANT IT COULD DO NOTHING. A new
 * organization has no workspace, and without `workspaces:create` its founder
 * could not make one, so a free organization opened onto an empty Apps page in
 * no workspace at all. It now holds the teamwork keys and the caps keep it
 * small: one workspace, three people.
 *
 * Notes and tasks, because they let a team try the app and its live updates and
 * handle no money. Everything that touches sales, cash or customers is paid.
 * The trial of Basic that new organizations get is billing's (#88), not a plan.
 */
const FREE: PlanDefinition = {
  key: 'free',
  label: 'Free',
  isPublic: true,
  icon: 'sprout',
  features: [...EVERY_TIER, ...NOTES, ...TASKS],
  limits: {
    [LIMIT.organizationMembers]: 3,
    [LIMIT.organizationWorkspaces]: 1,
    [LIMIT.workspaceMembers]: 3,
    [NOTE_LIMIT.notes]: 100,
    [TASK_LIMIT.boards]: 3,
    [TASK_LIMIT.tasks]: 300,
  },
};

/**
 * Basic — one shop or branch: every sub-app, one workspace.
 *
 * The key stays `starter`: every subscription on it points at the key, and
 * renaming one is a data migration for a change only people read.
 */
const STARTER: PlanDefinition = {
  key: 'starter',
  label: 'Basic',
  isPublic: true,
  icon: 'rocket',
  features: [...EVERY_TIER, ...EVERY_SUB_APP],
  limits: {
    [LIMIT.organizationMembers]: 10,
    [LIMIT.organizationWorkspaces]: 1,
    [LIMIT.workspaceMembers]: 10,
    ...appLimits({
      queueWindows: 3,
      queueDisplays: 1,
      notes: 500,
      taskBoards: 20,
      tasks: 2_000,
      posItems: 500,
      stockItems: 500,
      bookingResources: 5,
      studioLayouts: 50,
      printAgents: 1,
    }),
  },
};

/**
 * Pro — a small chain: every sub-app, up to five branches, and more room in each.
 *
 * Priced (in #88's price table, never here) at less than five Basics, so a
 * five-branch shop has a reason to choose it.
 */
const PRO: PlanDefinition = {
  key: 'pro',
  label: 'Pro',
  isPublic: true,
  icon: 'zap',
  features: [...EVERY_TIER, ...EVERY_SUB_APP],
  limits: {
    [LIMIT.organizationMembers]: 50,
    [LIMIT.organizationWorkspaces]: 5,
    [LIMIT.workspaceMembers]: 50,
    ...appLimits({
      queueWindows: 10,
      queueDisplays: 5,
      notes: 5_000,
      taskBoards: 100,
      tasks: 20_000,
      posItems: 5_000,
      stockItems: 5_000,
      bookingResources: 25,
      studioLayouts: 500,
      printAgents: 5,
    }),
  },
};

/**
 * Custom — large or special deals, NOT on the public list. A chain with thirty
 * branches negotiates; it gets a plan made for its deal (copied from this one on
 * `/admin/plans`), not a fourth tier on the price list. The key stays
 * `enterprise` for the same reason Basic's stays `starter`.
 *
 * Its features are DERIVED from the composed registry rather than listed, the
 * same call `super-admin` makes: a frozen list would leave the tier quietly
 * ceasing to include everything. `canPlanEntitle` drops app-level keys, by the
 * same rule the plan editor and the write path use.
 *
 * The caps are deliberately finite. "Unlimited" is not expressible —
 * `resolveLimits` takes a number or falls back to the registry floor — so a
 * large number says "more than this deal will reach", as `super-admin`'s
 * `user:organizations: 9999` does.
 */
const ENTERPRISE: PlanDefinition = {
  key: 'enterprise',
  label: 'Custom',
  isPublic: false,
  icon: 'gem',
  features: ALL_FEATURES.filter((spec) => canPlanEntitle(spec.level)).map((spec) => spec.key),
  limits: {
    [LIMIT.organizationMembers]: 10_000,
    [LIMIT.organizationWorkspaces]: 1_000,
    [LIMIT.workspaceMembers]: 10_000,
    // The sub-apps' keys arrive through the derived feature list; their caps do not.
    ...appLimits({
      queueWindows: 50,
      queueDisplays: 20,
      notes: 50_000,
      taskBoards: 1_000,
      tasks: 200_000,
      posItems: 50_000,
      stockItems: 50_000,
      bookingResources: 100,
      studioLayouts: 5_000,
      printAgents: 20,
    }),
  },
};

/**
 * Ordered smallest first, which is the order the seeder logs them in and the
 * order a catalogue reads in. Nothing depends on it — plans have no ranking of
 * their own, because a plan is exactly the list of features it carries.
 */
export const PLANS: readonly PlanDefinition[] = [FREE, STARTER, PRO, ENTERPRISE];
