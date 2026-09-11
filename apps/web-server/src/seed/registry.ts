import { AUTH_FEATURE_REGISTRY } from '@kwtech/module-auth';
import { CHAT_FEATURE_REGISTRY, CHAT_LIMIT_REGISTRY } from '@kwtech/module-chat';
import type { FeatureContribution } from '@kwtech/module-kit';
import { composeFeatures, composeLimits, type LimitContribution, type WebModuleDescriptor } from '@kwtech/module-kit';
import type { FeatureSpec, LimitSpec, RoleLevel } from '@kwtech/module-permissions';
import { FEATURE_REGISTRY, isFeatureSurface, isRoleLevel, LIMIT_CONTRIBUTIONS } from '@kwtech/module-permissions';

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
 * Shaped as descriptors so `composeFeatures` can read them. Only `key` and
 * `features` are required by `WebModuleDescriptor`, which is what makes it the
 * cheap shape to borrow here — no Nest module has to be constructed.
 */
const FEATURE_SOURCES: readonly WebModuleDescriptor[] = [
  { key: 'permissions', features: FEATURE_REGISTRY },
  { key: 'auth', features: AUTH_FEATURE_REGISTRY },
  /*
   * ⚠ Chat's keys are not documentation. `module-chat` cannot use
   * `@RequireFeature` — the decorator belongs to another module — so its
   * operations are guarded by the BINDINGS in this registry, and composing it
   * here is what turns them on. Drop this line and every chat mutation is
   * reachable by anybody signed in.
   */
  { key: 'chat', features: CHAT_FEATURE_REGISTRY },
];

export const ALL_FEATURES: readonly FeatureSpec[] = composeFeatures(FEATURE_SOURCES).map(toFeatureSpec);

/**
 * EVERY module's caps, composed — the limits half of ALL_FEATURES.
 *
 * ⚠ Composed even though exactly one module declares caps today, because the
 * failure when a second one does is SILENT: `resolveLimits` builds its map by
 * walking whatever registry it was given, so an uncomposed key is dropped before
 * any check reads it and the cap resolves to "no limit" — with the operator's
 * number sitting in `perm_role_limit`, visible in the role editor, enforcing
 * nothing. Adding `module-chat` here is one entry in the array below, exactly as
 * its features are.
 */
const LIMIT_SOURCES: readonly WebModuleDescriptor[] = [
  { key: 'permissions', limits: LIMIT_CONTRIBUTIONS },
  { key: 'chat', limits: CHAT_LIMIT_REGISTRY },
];

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

export const ALL_LIMITS: readonly LimitSpec[] = composeLimits(LIMIT_SOURCES).map(toLimitSpec);
