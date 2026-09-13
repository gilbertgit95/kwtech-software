import { AUTH_FEATURE_REGISTRY } from '@kwtech/module-auth';
import {
  CHAT_DEFAULT_MOMENT_REGISTRY,
  CHAT_DEFAULT_REGISTRY,
  CHAT_FEATURE_REGISTRY,
  CHAT_LIMIT_REGISTRY,
} from '@kwtech/module-chat';
import type { FeatureContribution } from '@kwtech/module-kit';
import {
  composeDefaultMoments,
  composeDefaults,
  composeFeatures,
  composeLimits,
  type LimitContribution,
  type WebModuleDescriptor,
} from '@kwtech/module-kit';
import type { AppDefaultSpec, FeatureSpec, LimitSpec, RoleLevel } from '@kwtech/module-permissions';
import {
  APP_DEFAULT_MOMENT_REGISTRY,
  APP_DEFAULT_REGISTRY,
  FEATURE_REGISTRY,
  isFeatureSurface,
  isRoleLevel,
  LIMIT_CONTRIBUTIONS,
} from '@kwtech/module-permissions';

/**
 * EVERY module's features, composed. ← add a module's registry here
 *
 * The seeder used to read `FEATURE_REGISTRY` from `@kwtech/module-permissions`
 * alone, which quietly meant "permissions is the only module allowed to declare
 * rights". `module-auth` had none at the time, so nothing was missing; the
 * moment it did, its keys would have been absent from `perm_feature` and
 * therefore ungrantable — `perm_role_feature` has a foreign key to that table.
 *
 * Composed HERE rather than in either module, because neither may import the
 * other (PLAN §9): auth declares `FeatureContribution`s typed by
 * `@kwtech/module-kit`, permissions declares its own `FeatureSpec`s, and the app
 * is the one place that has both. Same seam as `resolvePrincipal`.
 *
 * ## Why the registries and not the module descriptors
 *
 * `authServerModule()` and `permissionsServerModule()` DO carry these lists, and
 * composing from `SERVER_MODULES` would be the tidier-looking version. It is
 * not available to a script: building those descriptors calls
 * `AuthModule.forRoot()`, which asserts `AUTH_JWT_SECRET` at construction — a
 * seed task that only wants a list of keys would fail on a missing secret it
 * never uses. So the descriptors stay honest for anything running inside Nest,
 * and this composes the same lists directly.
 *
 * ## Duplicate keys
 *
 * Refused by `composeFeatures`, which is module-kit's own rule and was already
 * written — this file previously carried a second implementation of it. Two
 * modules defining one key differently is exactly the ambiguity a shared
 * registry exists to prevent, and there should be one place that says so.
 */

/**
 * A contribution narrowed to a spec, CHECKED rather than cast.
 *
 * The two types differ in exactly the places module-kit deliberately stayed
 * loose: `level` is optional there (an app with no permission model still
 * composes descriptors) and `surface` is a plain `string` (module-kit must not
 * own this module's vocabulary). A cast would paper over both and write a row
 * nothing can grant, or a binding naming a surface that does not exist.
 *
 * Validating instead means a module with a typo fails the SEED, with its own key
 * and the offending value named — which is the only moment anybody is looking.
 */
function toFeatureSpec(contribution: FeatureContribution): FeatureSpec {
  const { level, bindings, ...rest } = contribution;

  if (!level || !isRoleLevel(level)) {
    throw new Error(`Feature '${contribution.key}' has no valid level. Expected 'app' | 'organization' | 'workspace'.`);
  }

  const checked = (bindings ?? []).map((binding) => {
    if (!isFeatureSurface(binding.surface)) {
      throw new Error(`Feature '${contribution.key}' binds an unknown surface '${binding.surface}'.`);
    }
    return { surface: binding.surface, identifier: binding.identifier };
  });

  return { ...rest, level: level as RoleLevel, bindings: checked };
}

/**
 * ── WHAT EVERY MODULE DECLARES, IN ONE LIST ────────────────────────────────
 *
 * One descriptor per module, carrying all four of its registries.
 *
 * ## ⚠ Why this is one array and not three
 *
 * It WAS three — `FEATURE_SOURCES`, `LIMIT_SOURCES`, `DEFAULT_SOURCES` — each
 * listing the same modules again. That is three chances to add a module to two
 * of them, and **every one of those omissions is silent**:
 *
 *   features   an unlisted module's BINDINGS never load, so every one of its
 *              mutations is reachable by anybody signed in. `module-chat`
 *              cannot use `@RequireFeature` — the decorator belongs to another
 *              module — so this registry IS its guard.
 *   limits     an undeclared cap resolves to UNLIMITED, which is the expensive
 *              direction and reports nothing.
 *   defaults   an uncomposed default has no row on the screen and is never
 *              resolved, so an operator sets a value nothing reads.
 *
 * `WebModuleDescriptor` already carries all four fields, and each composer
 * ignores a module that declares nothing for it. So one list feeds all of them,
 * and adopting a module is one line that cannot be half-done.
 *
 * ⚠ Descriptors rather than Nest modules on purpose: only `key` is required, so
 * nothing here has to construct a `DynamicModule` to be counted.
 */
const MODULE_DECLARATIONS: readonly WebModuleDescriptor[] = [
  {
    key: 'permissions',
    features: FEATURE_REGISTRY,
    limits: LIMIT_CONTRIBUTIONS,
    defaults: APP_DEFAULT_REGISTRY,
    defaultMoments: APP_DEFAULT_MOMENT_REGISTRY,
  },
  { key: 'auth', features: AUTH_FEATURE_REGISTRY },
  {
    key: 'chat',
    features: CHAT_FEATURE_REGISTRY,
    limits: CHAT_LIMIT_REGISTRY,
    defaults: CHAT_DEFAULT_REGISTRY,
    defaultMoments: CHAT_DEFAULT_MOMENT_REGISTRY,
  },
];

export const ALL_FEATURES: readonly FeatureSpec[] = composeFeatures(MODULE_DECLARATIONS).map(toFeatureSpec);

/**
 * The HEADINGS those defaults appear under, from the same sources.
 *
 * ⚠ Composed from one list with the defaults themselves, so a module cannot be
 * added to one and forgotten in the other. The screen groups by moment; a
 * module whose moment nobody named gets an unnamed section at the bottom rather
 * than — as the screen did before this — no section and no row at all.
 *
 * ⚠ NOT a duplicate-throws compose. A moment is a shared namespace, so two
 * modules naming one is legitimate: the lowest order wins. See
 * `composeDefaultMoments`.
 */
export const ALL_DEFAULT_MOMENTS = composeDefaultMoments(MODULE_DECLARATIONS);

/**
 * Every default the app offers, narrowed to what the resolving module needs.
 *
 * ⚠ CHECKED rather than cast, exactly as `toFeatureSpec` is: a contribution is
 * a looser shape than a spec — `kind` and `moment` are plain strings, because
 * `module-kit` must not own the resolving module's vocabulary — and the narrow
 * happens once, here, where a bad value is a boot failure rather than a screen
 * that renders nothing.
 */
export const ALL_DEFAULTS: readonly AppDefaultSpec[] = composeDefaults(MODULE_DECLARATIONS).map((contribution) => ({
  key: contribution.key,
  module: contribution.module,
  kind: contribution.kind as AppDefaultSpec['kind'],
  moment: contribution.moment,
  label: contribution.label,
  description: contribution.description,
  whenUnset: contribution.whenUnset,
  ...(contribution.choices ? { choices: contribution.choices } : {}),
}));

/**
 * A contribution narrowed to a spec, CHECKED rather than cast — `toFeatureSpec`
 * one field over.
 *
 * `countedOver` is the field that matters. module-kit keeps it a plain string
 * because it must not own this module's vocabulary; the enforcer counts over
 * exactly three things, and a module naming a fourth has declared a cap nothing
 * can resolve. Better the seed fails with the key and the bad value than a
 * number that never denies.
 */
function toLimitSpec(contribution: LimitContribution): LimitSpec {
  const { countedOver, ...rest } = contribution;

  if (countedOver !== 'user' && countedOver !== 'organization' && countedOver !== 'workspace') {
    throw new Error(
      `Limit '${contribution.key}' is counted over '${countedOver}'. Expected 'user' | 'organization' | 'workspace'.`,
    );
  }

  return { ...rest, countedOver, required: contribution.required ?? false };
}

export const ALL_LIMITS: readonly LimitSpec[] = composeLimits(MODULE_DECLARATIONS).map(toLimitSpec);
