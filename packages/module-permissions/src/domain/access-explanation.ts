import type { FeatureKey, FeatureSpec, RoleLevel } from '../types.js';
import { type ComposeInput, composeContext } from './grants.js';
import { type RoleHolder, type RoleHolderCandidate, rolesHoldingFeature } from './role-holders.js';

/**
 * One person's access, explained key by key (#173, the last item of #25).
 *
 * ⚠ IT ASKS `composeContext`, IT DOES NOT RESTATE IT. Which roles apply at a
 * level, what the plan filters and what an app-level grant skips are decided
 * in one place (domain/grants.ts). A second copy of those rules here would be
 * a page that explains access by rules the guard no longer uses, the day
 * either changed. So the verdict is read from the composed context, and the
 * roles behind a grant are found by composing each role ON ITS OWN with no
 * plan: whatever that grants, the role contributes.
 *
 * Three answers per key, the same three a refusal gives:
 *
 *   granted       a role includes it, and the plan does too (or it needs none)
 *   not_entitled  a role includes it, the organization's plan does not
 *   not_granted   none of the person's roles includes it
 */
export type AccessVerdict = 'granted' | 'not_entitled' | 'not_granted';

export interface AccessLine {
  key: FeatureKey;
  label: string;
  description: string;
  module: string;
  level: RoleLevel;
  verdict: AccessVerdict;
  /**
   * The person's roles that include it, by label. Empty for `not_granted`.
   * For `not_entitled` it is the roles whose grant the plan filtered out.
   */
  grantedBy: readonly string[];
  /** Whether one of `grantedBy` is a platform (app-level) role, which skips the plan. */
  viaPlatformRole: boolean;
  /** The plans that include it, by label, for `not_entitled`. Empty otherwise. */
  inPlans: readonly string[];
  /** The seeded roles that would allow it, for `not_granted` (#99's rule). Empty otherwise. */
  holders: readonly RoleHolder[];
}

export interface ExplainAccessInput {
  /** What the guard composes for this person here, exactly as `loadContext` builds it. */
  compose: ComposeInput;
  /** The composed feature registry. Only the keys at the scope's levels are explained. */
  specs: readonly FeatureSpec[];
  /** Live plans, for naming the ones that include a filtered key. */
  plans: readonly { label: string; features: readonly FeatureKey[] }[];
  /** Seeded roles, for naming the ones that would allow a missing key. */
  roles: readonly RoleHolderCandidate[];
}

/**
 * Every organization key, and every workspace key when a workspace is in hand,
 * with its verdict and the reason behind it.
 *
 * App-level keys are left out: they are platform staff powers, never something
 * an organization's admin can give or a plan can sell, so a line saying "no"
 * to each of them would be noise on every customer's page.
 *
 * Sorted by module, then label, so a long list reads in groups.
 */
export function explainAccess(input: ExplainAccessInput): AccessLine[] {
  const context = composeContext(input.compose);
  const effective = new Set(context.effective);
  const granted = new Set(context.granted);
  const levels: readonly RoleLevel[] = context.workspaceId ? ['organization', 'workspace'] : ['organization'];

  /*
   * What each role contributes HERE: the role composed alone, with no plan
   * (`plans: undefined` is "no subscription model", which filters nothing).
   * That keeps the applies-at-this-level rule in composeContext.
   */
  const contributions = input.compose.roles.map((role) => ({
    label: role.label ?? role.roleKey,
    isPlatform: role.level === 'app',
    features: new Set(composeContext({ ...input.compose, roles: [role], plans: undefined }).granted),
  }));

  return input.specs
    .filter((spec) => levels.includes(spec.level))
    .map((spec): AccessLine => {
      const by = contributions.filter((role) => role.features.has(spec.key));
      const verdict: AccessVerdict = effective.has(spec.key)
        ? 'granted'
        : granted.has(spec.key)
          ? 'not_entitled'
          : 'not_granted';
      return {
        key: spec.key,
        label: spec.label,
        description: spec.description,
        module: spec.module,
        level: spec.level,
        verdict,
        grantedBy: [...new Set(by.map((role) => role.label))].sort(),
        viaPlatformRole: verdict === 'granted' && by.some((role) => role.isPlatform),
        inPlans:
          verdict === 'not_entitled'
            ? input.plans
                .filter((plan) => plan.features.includes(spec.key))
                .map((plan) => plan.label)
                .sort()
            : [],
        holders: verdict === 'not_granted' ? rolesHoldingFeature(input.roles, spec.key, spec.level) : [],
      };
    })
    .sort((a, b) => a.module.localeCompare(b.module) || a.label.localeCompare(b.label));
}

/** Whose access the sentence is about: the viewer's own, or someone else's. */
export type AccessSubject = 'self' | 'other';

/**
 * The reason, as one sentence a person can act on.
 *
 *   granted       "Their Supervisor role includes it."
 *   not_entitled  "Their Organization admin role includes it, but the plan does not. It is in Basic or Pro."
 *   not_granted   "None of their roles includes it. The Supervisor or Workspace admin role does."
 */
export function accessReasonText(line: AccessLine, subject: AccessSubject = 'other'): string {
  const their = subject === 'self' ? 'Your' : 'Their';
  switch (line.verdict) {
    case 'granted': {
      const roles = rolesPhrase(line.grantedBy);
      if (line.viaPlatformRole) return `${their} platform ${roles} ${includes(line.grantedBy)} it, whatever the plan.`;
      return `${their} ${roles} ${includes(line.grantedBy)} it.`;
    }
    case 'not_entitled': {
      const head = `${their} ${rolesPhrase(line.grantedBy)} ${includes(line.grantedBy)} it, but the organization's plan does not.`;
      if (line.inPlans.length === 0) return `${head} No plan on offer includes it.`;
      return `${head} It is in ${joinWith(line.inPlans, 'or')}.`;
    }
    case 'not_granted': {
      const head = `None of ${subject === 'self' ? 'your' : 'their'} roles includes it.`;
      if (line.holders.length === 0) return `${head} No seeded role does either.`;
      return `${head} The ${joinWith(
        line.holders.map((role) => role.label),
        'or',
      )} role does.`;
    }
  }
}

/** "Supervisor role", "Staff and Supervisor roles". */
function rolesPhrase(labels: readonly string[]): string {
  if (labels.length === 0) return 'role';
  return `${joinWith(labels, 'and')} ${labels.length === 1 ? 'role' : 'roles'}`;
}

/** Agrees with `rolesPhrase`: "role includes", "roles include". */
function includes(labels: readonly string[]): string {
  return labels.length > 1 ? 'include' : 'includes';
}

function joinWith(names: readonly string[], word: 'and' | 'or'): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${word} ${names.at(-1)}`;
}
