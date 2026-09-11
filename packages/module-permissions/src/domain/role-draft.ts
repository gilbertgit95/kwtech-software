import type { FeatureKey, FeatureSpec, RoleLevel } from '../types.js';
import { ROLE_LEVELS } from '../types.js';
import { type CloneMode, type CloneResult, mergeFeatures } from './feature-merge.js';
import { LIMIT_REGISTRY, type LimitSpec } from './limits.js';
import { canRoleGrant } from './roles.js';

/**
 * A role being written, before it is a row.
 *
 * The same idea as `FeatureDraft`: one validator, shared by the create form, the
 * edit form and the write service, so a screen and an endpoint cannot disagree
 * about what a valid role is. Two validators is one validator plus a future bug
 * report about an API that accepted something the form refused.
 *
 * Unlike a feature draft, this is NOT all strings — `features` arrives from a
 * multi-select and `organizationId` from a dropdown, both already structured.
 * A spreadsheet never produces one of these, which is the whole reason roles
 * have no import.
 */
export interface RoleDraft {
  key: string;
  label: string;
  level: string;
  /** Icon NAME for the badge. Empty means none. See PermRole.icon. */
  icon: string;
  features: readonly FeatureKey[];
  /**
   * The caps this role GRANTS, key → string.
   *
   * Strings for the same reason `PlanDraft.limits` uses them: the values come
   * from `<input type="number">`, which yields `''` mid-edit and `'abc'` on a
   * browser that does not filter. A draft holding `NaN` validates cleanly,
   * saves, and caps somebody at nothing.
   *
   * ⚠ ONLY APP-LEVEL ROLES MAY CARRY THEM, and that is not a style rule:
   * `resolveLimits` reads `roles.filter((role) => role.level === 'app')`, so a
   * number on an organization-level role is dropped before anything reads it.
   * The row would save, the editor would redisplay it, and it would cap
   * nothing — which is why `validateRoleLimits` refuses it rather than letting
   * the write path quietly drop it.
   */
  limits: Readonly<Record<string, string>>;
}

/*
 * ── no organizationId ───────────────────────────────────────────────────────
 *
 * Every role written through this path is a SHARED PRESET — `organizationId`
 * null, which the schema defines as "a preset shared by every organization".
 *
 * What scopes a role is its LEVEL, not an owner: an organization-level role
 * applies inside whichever organization it is granted in, and a workspace-level
 * one inside whichever workspace. Attaching an owner as well would answer the
 * same question twice, and the two answers can disagree — a role owned by
 * organization A but granted in B is the cross-tenant grant `assertRoleAssignable`
 * exists to refuse.
 *
 * The COLUMN stays: `PermRole.organizationId` still supports a role one tenant
 * defined for itself, and the read path still filters on it. Nothing here can
 * create one, which is the deliberate part — a tenant-owned role needs an
 * organization picker, and no organization exists to pick.
 */

export const EMPTY_ROLE_DRAFT: RoleDraft = {
  key: '',
  label: '',
  level: 'organization',
  icon: '',
  features: [],
  /**
   * ⚠ EMPTY, and deliberately NOT prefilled the way `EMPTY_PLAN_DRAFT` is.
   *
   * The two cases look alike and are opposites. A plan's required caps must be
   * set or the plan is invalid, so prefilling saves the author from a form that
   * cannot be submitted. A role's caps are ADDITIVE BY MAX across the roles
   * somebody holds, and a blank means "this role says nothing about it" —
   * which is what nearly every role should say. Prefilling would make every new
   * role silently grant a cap its author never chose, and because the
   * resolution is a max, that cap would then RAISE the allowance of everyone
   * holding it.
   */
  limits: {},
};

/**
 * Kebab-case, no colon.
 *
 * Deliberately NOT `FEATURE_KEY_PATTERN`. A feature key is `area:action`
 * because it names a verb on a noun; a role key is a NAME — `super-admin`,
 * `normal-user`, `client` — and the three that already exist are the pattern
 * this is derived from. Letting a role be called `billing:manage` would make
 * the two vocabularies indistinguishable in a log line, which is exactly where
 * someone reads them side by side.
 */
export const ROLE_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

export type RoleDraftErrors = Partial<Record<keyof RoleDraft, string>>;

export interface ValidateRoleOptions {
  /** The registry, for checking every chosen feature exists and at what level. */
  registry: readonly FeatureSpec[];
  /** Keys already taken IN THE SAME SCOPE. See `roleScopeKey`. */
  existingKeys?: readonly string[];
  /** The key being edited, so an unchanged form still validates. */
  originalKey?: string;
  /**
   * What the ACTOR may do, for the no-escalation rule below. Omit to skip the
   * check — which the seeder does, because a seed script is the machine and has
   * no actor to be limited by.
   */
  actorFeatures?: readonly FeatureKey[];
  /** Whether the actor may write an APP-level role at all. See `roles:manage_app`. */
  actorMayWriteAppRoles?: boolean;
  /**
   * Every cap declared across every module, for checking the ones this role
   * sets. Defaults to this module's own — correct for a test, and wrong for an
   * app that mounts a module contributing caps, which is why the write path
   * passes the composed registry.
   */
  limits?: readonly LimitSpec[];
}

/**
 * Everything wrong with a draft, ALL AT ONCE rather than the first problem —
 * same reason as `validateDraft`: a form that reports one error per submit
 * makes someone play twenty questions with it.
 */
export function validateRoleDraft(draft: RoleDraft, options: ValidateRoleOptions): RoleDraftErrors {
  const errors: RoleDraftErrors = {};
  const key = draft.key.trim();

  if (!key) errors.key = 'A key is required.';
  else if (!ROLE_KEY_PATTERN.test(key)) {
    errors.key = "Use lower-case words joined by hyphens, e.g. 'support-agent'.";
  } else if (options.existingKeys?.includes(key) && key !== options.originalKey) {
    /*
     * Refused here rather than left to the database, because the database
     * CANNOT refuse it for the rows that matter most: `@@unique([organizationId,
     * key])` does not constrain app-level roles, since organizationId is null
     * there and Postgres treats NULLs as distinct. Two `super-admin` rows can
     * coexist and whichever one wins a lookup decides what a person holds.
     * See docs/PLAN.md §12.19 — this check is the stopgap standing in for the
     * partial unique index Prisma cannot express.
     */
    errors.key = `'${key}' is already used by another role at this level.`;
  }

  if (!draft.label.trim()) errors.label = 'A label is required.';

  if (!isRoleLevel(draft.level)) {
    errors.level = `Level must be one of: ${ROLE_LEVELS.join(', ')}.`;
    // Every check below reads the level; carrying on would report nonsense.
    return errors;
  }

  const level: RoleLevel = draft.level;

  /*
   * The escalation the level rule does NOT close.
   *
   * `assertRoleFeatureLevels` stops an organization role collecting app-level
   * features, but nothing there stops an organization administrator MINTING an
   * app-level role — and an app role applies in every organization and skips
   * the subscription filter. The dangerous half is the role's own level, not
   * the features it carries, so that is what this guards.
   */
  if (level === 'app' && options.actorMayWriteAppRoles === false) {
    errors.level = 'You may not create or change app-level roles.';
  }

  const featureError = validateRoleFeatures(draft.features, level, options);
  if (featureError) errors.features = featureError;

  const limitError = validateRoleLimits(draft.limits, level, options.limits ?? LIMIT_REGISTRY);
  if (limitError) errors.limits = limitError;

  return errors;
}

/**
 * Every cap this role sets: role-sourced, declared, whole, and only on an
 * app-level role.
 *
 * ## Why a blank is not zero
 *
 * An empty box means "this role says nothing about this cap" and contributes
 * nothing to the max. A typed `0` means "this role grants none of it" — a
 * contractor role that may use chat and create no group conversations is a real
 * configuration, and it is the one the plan named when it argued `chat:read`
 * earns a key at all. Both are legitimate and they are different, so the
 * validator distinguishes them and the write path stores only what was typed.
 *
 * ⚠ Zero is allowed here even though `LimitSpec.defaultValue` never uses it.
 * That floor is about what an UNCONFIGURED person gets, where zero would stop
 * an organization's founder being its first member. This is an operator
 * deliberately setting a cap on a named role, which is a different act — and it
 * cannot lock anybody out by itself, because caps resolve as the MAX across the
 * roles somebody holds and the registry default applies when no role sets one.
 */
function validateRoleLimits(
  limits: Readonly<Record<string, string>>,
  level: RoleLevel,
  registry: readonly LimitSpec[],
): string | undefined {
  const bySource = new Map(registry.map((spec) => [spec.key, spec.source]));
  const set = Object.entries(limits).filter(([, raw]) => (raw ?? '').trim() !== '');
  if (set.length === 0) return undefined;

  /*
   * The whole reason this check exists. `resolveLimits` filters to app-level
   * roles, so a cap on any other level is dropped before a check reads it —
   * saved, redisplayed, and enforcing nothing.
   */
  if (level !== 'app') {
    return `only app-level roles carry caps, and this role is ${level}-level: ${set
      .map(([key]) => key)
      .sort()
      .join(', ')}`;
  }

  const unknown: string[] = [];
  const wrongSource: string[] = [];
  const invalid: string[] = [];

  for (const [key, raw] of set) {
    const source = bySource.get(key);
    if (!source) {
      // An undeclared cap resolves to "no limit" — see LimitContribution.
      unknown.push(key);
      continue;
    }
    /*
     * A plan-sourced cap on a role is the mirror of the level mistake:
     * `resolveLimits` reads plan-sourced keys from SUBSCRIPTIONS only, so the
     * number would be stored and never consulted.
     */
    if (source !== 'role') wrongSource.push(key);

    const value = Number(raw.trim());
    if (!Number.isInteger(value) || value < 0) invalid.push(key);
  }

  const problems: string[] = [];
  if (unknown.length > 0) problems.push(`not declared by any module: ${unknown.sort().join(', ')}`);
  if (wrongSource.length > 0) problems.push(`sold by a plan, not granted by a role: ${wrongSource.sort().join(', ')}`);
  if (invalid.length > 0) problems.push(`must be a whole number of 0 or more: ${invalid.sort().join(', ')}`);
  return problems.length > 0 ? problems.join('; ') : undefined;
}

/**
 * The draft's caps as the numbers a `perm_role_limit` row stores.
 *
 * Only ever called on a draft that has validated: blanks are dropped and
 * anything unparseable is skipped, because a bad value reaching here would be a
 * bug rather than user input, and writing `NaN` into a cap is the worst
 * available way to react to one.
 *
 * ⚠ Returns NOTHING for a role that is not app level, whatever the draft holds.
 * The validator refuses that combination, and this is the second door on the
 * same room: a caller that skipped validation writes no rows instead of writing
 * rows that never apply.
 */
export function roleLimitValues(
  limits: Readonly<Record<string, string>>,
  level: string,
  registry: readonly LimitSpec[] = LIMIT_REGISTRY,
): Record<string, number> {
  if (level !== 'app') return {};

  const values: Record<string, number> = {};
  for (const spec of registry) {
    if (spec.source !== 'role') continue;
    const raw = (limits[spec.key] ?? '').trim();
    if (!raw) continue;
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 0) values[spec.key] = value;
  }
  return values;
}

/** The stored numbers as the strings a form edits. The inverse of the above. */
export function roleLimitFields(limits: Readonly<Record<string, number>>): Record<string, string> {
  return Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, String(value)]));
}

function validateRoleFeatures(
  features: readonly FeatureKey[],
  level: RoleLevel,
  options: ValidateRoleOptions,
): string | undefined {
  const byKey = new Map(options.registry.map((spec) => [spec.key, spec]));
  const unregistered: string[] = [];
  const wrongLevel: string[] = [];
  const notHeld: string[] = [];
  const actor = options.actorFeatures ? new Set(options.actorFeatures) : null;

  for (const key of features) {
    const spec = byKey.get(key);
    /*
     * An unregistered key can never be CHECKED, so a role carrying one grants
     * nothing while reading as access in the editor. Refused at every level,
     * app included — the same rule assertRoleFeatureLevels enforces.
     */
    if (!spec) {
      unregistered.push(key);
      continue;
    }
    // Own level or narrower; never broader. One rule, in domain/roles.ts.
    if (!canRoleGrant(level, spec.level)) wrongLevel.push(key);
    /*
     * NO ESCALATION: you may not put a right into a role that you do not hold
     * yourself. Without it, one coarse "create roles" key is indirectly every
     * key in the system — compose a role granting everything, assign it to
     * yourself, and the permission model has been walked around rather than
     * broken. Cloning is the fastest route to it, which is why clone filters
     * through this same rule rather than trusting its source.
     */
    if (actor && !actor.has(key)) notHeld.push(key);
  }

  const problems: string[] = [];
  if (unregistered.length > 0) problems.push(`not in the registry: ${unregistered.sort().join(', ')}`);
  if (wrongLevel.length > 0) {
    problems.push(`broader than a ${level}-level role may grant: ${wrongLevel.sort().join(', ')}`);
  }
  if (notHeld.length > 0) problems.push(`you do not hold: ${notHeld.sort().join(', ')}`);

  return problems.length > 0 ? problems.join('; ') : undefined;
}

/**
 * Copies one role's features onto another, filtered by the same rules a manual
 * edit obeys.
 *
 * A thin wrapper over `mergeFeatures`, which plans share: the only role-shaped
 * parts are the level rule (`canRoleGrant`, own level or narrower) and the
 * no-escalation rule (you may not put a right into a role that you do not hold
 * yourself). Cloning is the fastest route to that escalation, which is why it
 * filters through the same predicate a hand edit does rather than trusting its
 * source.
 */
export type { CloneMode, CloneResult, CloneSkip } from './feature-merge.js';

export function cloneFeatures(
  current: readonly FeatureKey[],
  incoming: readonly FeatureKey[],
  mode: CloneMode,
  level: RoleLevel,
  options: { registry: readonly FeatureSpec[]; actorFeatures?: readonly FeatureKey[] },
): CloneResult {
  return mergeFeatures(current, incoming, mode, {
    registry: options.registry,
    accepts: (spec) => canRoleGrant(level, spec.level),
    ...(options.actorFeatures ? { actorFeatures: options.actorFeatures } : {}),
  });
}

/**
 * The scope a role key must be unique WITHIN.
 *
 * App-level roles and shared presets both carry a null organizationId, so they
 * share one namespace; every organization has its own. Expressed as a string so
 * a caller can group by it without repeating the null-handling that
 * `@@unique([organizationId, key])` gets wrong.
 */
export function roleScopeKey(organizationId: string | null): string {
  return organizationId ?? '@app';
}

function isRoleLevel(value: string): value is RoleLevel {
  return (ROLE_LEVELS as readonly string[]).includes(value);
}
