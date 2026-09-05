import { AUTH_FEATURE_REGISTRY } from '@kwtech/module-auth';
import type { FeatureContribution } from '@kwtech/module-kit';
import { composeFeatures, type WebModuleDescriptor } from '@kwtech/module-kit';
import type { FeatureSpec, RoleLevel } from '@kwtech/module-permissions';
import { FEATURE_REGISTRY, isFeatureSurface, isRoleLevel } from '@kwtech/module-permissions';

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
];

export const ALL_FEATURES: readonly FeatureSpec[] = composeFeatures(FEATURE_SOURCES).map(toFeatureSpec);
