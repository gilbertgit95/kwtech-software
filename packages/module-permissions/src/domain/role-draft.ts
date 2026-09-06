import type { FeatureKey, FeatureSpec, RoleLevel } from '../types.js';
import { ROLE_LEVELS } from '../types.js';
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

  return errors;
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
 * How a clone combines with what the role already carries.
 *
 * The same two answers the feature import offers, and named for what happens to
 * the rows ALREADY THERE rather than to the incoming ones — that is the half at
 * risk, since the source role's features arrive either way.
 */
export type CloneMode = 'replace' | 'add';

export interface CloneResult {
  /** What the role should carry afterwards, sorted and de-duplicated. */
  features: FeatureKey[];
  /** Newly present that were not there before. */
  added: FeatureKey[];
  /**
   * Dropped, and WHY — a clone that silently grants less than the role it
   * copied would be discovered as a denial weeks later. The screen shows this.
   */
  skipped: { key: FeatureKey; reason: 'wrong_level' | 'not_held' | 'unregistered' }[];
}

/**
 * Copies one role's features onto another, filtered by the same rules a manual
 * edit obeys.
 *
 * Filtering rather than refusing is deliberate: a super admin's 17 features
 * cloned into an organization role would fail validation wholesale, and the
 * person would have no way to act on that except to un-tick them one at a time.
 * Dropping what cannot apply and SAYING SO leaves them with a working role and
 * an accurate list of what did not come across.
 */
export function cloneFeatures(
  current: readonly FeatureKey[],
  incoming: readonly FeatureKey[],
  mode: CloneMode,
  level: RoleLevel,
  options: { registry: readonly FeatureSpec[]; actorFeatures?: readonly FeatureKey[] },
): CloneResult {
  const byKey = new Map(options.registry.map((spec) => [spec.key, spec]));
  const actor = options.actorFeatures ? new Set(options.actorFeatures) : null;
  const skipped: CloneResult['skipped'] = [];
  const accepted: FeatureKey[] = [];

  for (const key of incoming) {
    const spec = byKey.get(key);
    if (!spec) {
      skipped.push({ key, reason: 'unregistered' });
      continue;
    }
    if (!canRoleGrant(level, spec.level)) {
      skipped.push({ key, reason: 'wrong_level' });
      continue;
    }
    if (actor && !actor.has(key)) {
      skipped.push({ key, reason: 'not_held' });
      continue;
    }
    accepted.push(key);
  }

  /*
   * 'replace' discards what was there; 'add' keeps it. Neither touches the
   * database — this is the STAGED list the form then shows, so nothing is
   * committed until Save, exactly as the feature import stages its rows.
   */
  const base = mode === 'replace' ? [] : [...current];
  const features = [...new Set([...base, ...accepted])].sort();
  const before = new Set(current);

  return { features, added: features.filter((key) => !before.has(key)), skipped };
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
