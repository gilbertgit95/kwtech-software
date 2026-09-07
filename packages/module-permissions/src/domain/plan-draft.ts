import type { FeatureKey, FeatureSpec } from '../types.js';
import { type CloneMode, type CloneResult, mergeFeatures } from './feature-merge.js';
import { LIMIT_REGISTRY, type LimitSpec } from './limits.js';
import { canPlanEntitle } from './plans.js';

/**
 * A plan being written, before it is a row.
 *
 * The same idea as `RoleDraft`: one validator, shared by the create form, the
 * edit form and the write service, so a screen and an endpoint cannot disagree
 * about what a valid plan is.
 *
 * `limits` is a map of key → STRING, not number, and that is the one shape
 * decision worth explaining. The values come from `<input type="number">`,
 * which yields `''` while somebody is mid-edit and `'abc'` on a browser that
 * does not filter — and a draft holding `NaN` validates cleanly, saves, and
 * caps a paying customer at nothing. Keeping them as text means the validator
 * is the single place that decides what a number is.
 */
export interface PlanDraft {
  key: string;
  label: string;
  isPublic: boolean;
  /** Icon NAME for the badge. Empty means none. See PermPlan.icon. */
  icon: string;
  features: readonly FeatureKey[];
  limits: Readonly<Record<string, string>>;
}

/**
 * Kebab-case, no colon — the same pattern and the same argument as
 * `ROLE_KEY_PATTERN`. A plan key is a NAME (`free`, `team`, `enterprise`), not
 * a verb on a noun, and letting one be called `billing:manage` would make the
 * two vocabularies indistinguishable in the log line where they sit side by
 * side.
 */
export const PLAN_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * What a new plan's caps start at.
 *
 * A starting point, not a recommendation — five is small enough that nobody
 * ships it by accident thinking it is generous, and large enough to be a
 * working plan for a team trying the product. The alternative was blank boxes,
 * which fail validation on the first save of every plan anybody ever creates:
 * these caps are REQUIRED, so an empty form is a form that cannot be submitted
 * until three numbers are typed.
 */
export const DEFAULT_PLAN_LIMIT = 5;

/**
 * The caps a new plan starts with: `DEFAULT_PLAN_LIMIT` for every REQUIRED
 * plan-sourced key, and nothing for the rest.
 *
 * Derived from `LIMIT_REGISTRY` rather than listed, so a cap added there is
 * prefilled on the next build instead of appearing as the one blank box that
 * blocks the form.
 *
 * ⚠ Required only, and the omission is deliberate. A blank OPTIONAL cap means
 * "this plan does not set it" and resolves to the registry floor; prefilling it
 * would silently make every new plan cap something its author never chose. The
 * two states are different, and only one of them is safe to guess.
 *
 * Every plan-sourced cap is required today, so this is the whole set — the
 * distinction costs nothing now and is correct when it stops being free.
 */
export function defaultPlanLimitFields(registry: readonly LimitSpec[] = LIMIT_REGISTRY): Record<string, string> {
  return Object.fromEntries(
    registry
      .filter((spec) => spec.source === 'plan' && spec.required)
      .map((spec) => [spec.key, String(DEFAULT_PLAN_LIMIT)]),
  );
}

export const EMPTY_PLAN_DRAFT: PlanDraft = {
  key: '',
  label: '',
  /*
   * Public by default. A plan is a product: the ordinary case is one customers
   * can see, and the private case — a bespoke deal, a grandfathered tier — is
   * the deliberate exception. Defaulting the other way would mean every plan
   * anybody creates is invisible until they notice a checkbox.
   */
  isPublic: true,
  icon: '',
  features: [],
  limits: defaultPlanLimitFields(),
};

export type PlanDraftErrors = Partial<Record<keyof PlanDraft, string>>;

export interface ValidatePlanOptions {
  /** The registry, for checking every chosen feature exists and at what level. */
  registry: readonly FeatureSpec[];
  /** Keys already taken. A plan key is the primary key, so the scope is global. */
  existingKeys?: readonly string[];
  /** The key being edited, so an unchanged form still validates. */
  originalKey?: string;
  /** Overridable for a test; defaults to the module's own limit registry. */
  limits?: readonly LimitSpec[];
}

/**
 * Everything wrong with a draft, ALL AT ONCE rather than the first problem —
 * the same reason `validateRoleDraft` reports them together: a form that
 * surfaces one error per submit makes someone play twenty questions with it.
 */
export function validatePlanDraft(draft: PlanDraft, options: ValidatePlanOptions): PlanDraftErrors {
  const errors: PlanDraftErrors = {};
  const key = draft.key.trim();

  if (!key) errors.key = 'A key is required.';
  else if (!PLAN_KEY_PATTERN.test(key)) {
    errors.key = "Use lower-case words joined by hyphens, e.g. 'team-annual'.";
  } else if (options.existingKeys?.includes(key) && key !== options.originalKey) {
    /*
     * The database WOULD refuse this one — `PermPlan.key` is the primary key,
     * unlike a role's `@@unique([organizationId, key])` which cannot constrain
     * null-scoped rows. It is checked here anyway so the form can say which
     * field is wrong, rather than surfacing a constraint violation as a
     * sentence about a plan somebody cannot see.
     */
    errors.key = `'${key}' is already used by another plan.`;
  }

  if (!draft.label.trim()) errors.label = 'A label is required.';

  const featureError = validatePlanFeatures(draft.features, options.registry);
  if (featureError) errors.features = featureError;

  const limitError = validatePlanLimits(draft.limits, options.limits ?? LIMIT_REGISTRY);
  if (limitError) errors.limits = limitError;

  return errors;
}

/**
 * There is deliberately NO no-escalation rule here, and the asymmetry with
 * roles is the point.
 *
 * A role GRANTS: putting a right into one that you do not hold yourself turns a
 * single "create roles" key into every key in the system, so `validateRoleDraft`
 * refuses it. A plan ENTITLES: it lifts the subscription filter off a feature
 * and nothing more. Whoever ends up using it still needs a role that grants the
 * key, and that role is still bound by the escalation rule — so a plan cannot
 * be the route around it.
 *
 * Writing plans is app-level and privileged in any case (`plans:create`,
 * `plans:update`), which is where the real constraint on who defines products
 * lives. Adding a second, weaker one here would only stop a platform
 * administrator selling a feature they personally do not use.
 */
function validatePlanFeatures(features: readonly FeatureKey[], registry: readonly FeatureSpec[]): string | undefined {
  const byKey = new Map(registry.map((spec) => [spec.key, spec]));
  const unregistered: string[] = [];
  const wrongLevel: string[] = [];

  for (const key of features) {
    const spec = byKey.get(key);
    // An unregistered key can never be checked, so a plan carrying one entitles
    // nothing while reading as a sold feature in the catalogue.
    if (!spec) {
      unregistered.push(key);
      continue;
    }
    // Organization and workspace only. See domain/plans.ts for why app-level
    // keys in a plan are inert rather than merely unusual.
    if (!canPlanEntitle(spec.level)) wrongLevel.push(key);
  }

  const problems: string[] = [];
  if (unregistered.length > 0) problems.push(`not in the registry: ${unregistered.sort().join(', ')}`);
  if (wrongLevel.length > 0) {
    problems.push(`app-level, so a plan cannot sell them: ${wrongLevel.sort().join(', ')}`);
  }
  return problems.length > 0 ? problems.join('; ') : undefined;
}

/**
 * Every plan-sourced cap, present and a positive whole number.
 *
 * REQUIRED ones are required here rather than only at seed time. `assertPlanLimits`
 * already refuses a definition that omits one, but it throws — which is right
 * for a seed script and wrong for a form, where the person needs to be told
 * which field to fill in. Both read `LIMIT_REGISTRY`, so they cannot disagree
 * about which caps matter.
 *
 * A blank optional cap is dropped rather than treated as zero: leaving a box
 * empty means "this plan does not set it", and `resolveLimits` answers that
 * with the registry floor.
 */
function validatePlanLimits(
  limits: Readonly<Record<string, string>>,
  registry: readonly LimitSpec[],
): string | undefined {
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const spec of registry) {
    // Role-sourced caps — 'user:organizations' — come from an app-level role and
    // have no meaning inside a subscription. See domain/limits.ts.
    if (spec.source !== 'plan') continue;

    const raw = (limits[spec.key] ?? '').trim();
    if (!raw) {
      if (spec.required) missing.push(spec.key);
      continue;
    }

    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) invalid.push(spec.key);
  }

  const problems: string[] = [];
  if (missing.length > 0) problems.push(`required and unset: ${missing.sort().join(', ')}`);
  // Floor of one, not zero, for the reason `LimitSpec.defaultValue` gives: an
  // organization is created before it is subscribed, and a cap of zero stops
  // its founder from being its first member.
  if (invalid.length > 0) problems.push(`must be a whole number of 1 or more: ${invalid.sort().join(', ')}`);
  return problems.length > 0 ? problems.join('; ') : undefined;
}

/**
 * The draft's limits as the numbers a row stores.
 *
 * Only ever called on a draft that has already validated — blanks are dropped
 * and anything unparseable is skipped, because a value that reached here after
 * validation passed would have to be a bug rather than user input, and writing
 * `NaN` into a cap is the worst available way to react to one.
 */
export function planLimitValues(
  limits: Readonly<Record<string, string>>,
  registry: readonly LimitSpec[] = LIMIT_REGISTRY,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const spec of registry) {
    if (spec.source !== 'plan') continue;
    const raw = (limits[spec.key] ?? '').trim();
    if (!raw) continue;
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 1) values[spec.key] = value;
  }
  return values;
}

/** The stored numbers as the strings a form edits. The inverse of the above. */
export function planLimitFields(limits: Readonly<Record<string, number>>): Record<string, string> {
  return Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, String(value)]));
}

/**
 * Copies one plan's features onto another.
 *
 * The role clone's twin, differing in exactly the two ways plans differ: the
 * level rule is `canPlanEntitle` rather than `canRoleGrant`, and no
 * `actorFeatures` is passed — see `validatePlanFeatures` for why a plan has no
 * no-escalation rule to enforce.
 */
export function clonePlanFeatures(
  current: readonly FeatureKey[],
  incoming: readonly FeatureKey[],
  mode: CloneMode,
  options: { registry: readonly FeatureSpec[] },
): CloneResult {
  return mergeFeatures(current, incoming, mode, {
    registry: options.registry,
    accepts: (spec) => canPlanEntitle(spec.level),
  });
}
