import { APP_HUB_FEATURE_REGISTRY } from '@kwtech/module-app-hub';
import { AUTH_FEATURE_REGISTRY } from '@kwtech/module-auth';
import { BOOKS_FEATURE_REGISTRY } from '@kwtech/module-basic-bookkeeping';
import { POS_FEATURE_REGISTRY, POS_LIMIT_REGISTRY } from '@kwtech/module-basic-pos';
import { BOOKING_FEATURE_REGISTRY, BOOKING_LIMIT_REGISTRY, BOOKING_PROCESS_REGISTRY } from '@kwtech/module-booking';
import {
  CHAT_DEFAULT_MOMENT_REGISTRY,
  CHAT_DEFAULT_REGISTRY,
  CHAT_FEATURE_REGISTRY,
  CHAT_LIMIT_REGISTRY,
} from '@kwtech/module-chat';
import { JOBS_FEATURE_REGISTRY } from '@kwtech/module-jobs';
import type { FeatureContribution } from '@kwtech/module-kit';
import {
  composeDefaultMoments,
  composeDefaults,
  composeFeatures,
  composeLimits,
  composeProcesses,
  type LimitContribution,
  type ProcessDeclaration,
  type WebModuleDescriptor,
} from '@kwtech/module-kit';
import { NOTE_FEATURE_REGISTRY, NOTE_LIMIT_REGISTRY } from '@kwtech/module-note';
import { NOTIFICATION_FEATURE_REGISTRY } from '@kwtech/module-notification';
import type { AppDefaultSpec, FeatureSpec, LimitSpec, RoleLevel } from '@kwtech/module-permissions';
import {
  APP_DEFAULT_MOMENT_REGISTRY,
  APP_DEFAULT_REGISTRY,
  FEATURE_REGISTRY,
  isFeatureSurface,
  isRoleLevel,
  LIMIT_CONTRIBUTIONS,
} from '@kwtech/module-permissions';
import { STUDIO_FEATURE_REGISTRY, STUDIO_LIMIT_REGISTRY, STUDIO_PROCESS_REGISTRY } from '@kwtech/module-print-studio';
import { QUEUE_FEATURE_REGISTRY, QUEUE_LIMIT_REGISTRY } from '@kwtech/module-queuing-window';
import { TASK_FEATURE_REGISTRY, TASK_LIMIT_REGISTRY, TASK_PROCESS_REGISTRY } from '@kwtech/module-task';

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
 *
 * `processes` is the FIFTH registry, and the one a web descriptor does not
 * carry — a browser runs none. It is the declaration WITHOUT its handler, which
 * is what lets this file list it: the handler is a Nest class, and the server
 * descriptor in `app.module.ts` is where the two are joined.
 *
 *   processes  an unlisted module's processes are never mirrored to
 *              `job_process`, and the runner runs nothing that has no row. It
 *              says so in the boot log, once, and the reminders never arrive.
 */
type ModuleDeclaration = WebModuleDescriptor & { processes?: readonly ProcessDeclaration[] };

const MODULE_DECLARATIONS: readonly ModuleDeclaration[] = [
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
  /*
   * ⚠ THE BINDINGS ARE THE QUEUE'S GUARD, as chat's are — the module cannot use
   * `@RequireFeature`. Leaving this line out would leave every queue mutation
   * reachable by anybody signed in, and both caps unlimited.
   */
  { key: 'queue', features: QUEUE_FEATURE_REGISTRY, limits: QUEUE_LIMIT_REGISTRY },
  /*
   * ⚠ THE BINDINGS ARE NOTES' GUARD, as the queue's are. Leaving this line out
   * would leave every note operation reachable by anybody signed in, and the
   * per-person cap never mirrored for plans.
   */
  { key: 'note', features: NOTE_FEATURE_REGISTRY, limits: NOTE_LIMIT_REGISTRY },
  /*
   * ⚠ And the print studio's — its history names the files people printed,
   * which are often customers' names. Leave this out and that history is
   * readable by anybody signed in, the per-person cap is never mirrored for
   * plans, and the history is never pruned.
   */
  {
    key: 'studio',
    features: STUDIO_FEATURE_REGISTRY,
    limits: STUDIO_LIMIT_REGISTRY,
    processes: STUDIO_PROCESS_REGISTRY,
  },
  /*
   * ⚠ THE BINDINGS ARE THE GUARD of tasks and the point of sale, as the
   * queue's are. Leaving a line out would leave that module's every operation
   * reachable by anybody signed in, and its caps never mirrored for plans.
   */
  { key: 'task', features: TASK_FEATURE_REGISTRY, limits: TASK_LIMIT_REGISTRY, processes: TASK_PROCESS_REGISTRY },
  { key: 'pos', features: POS_FEATURE_REGISTRY, limits: POS_LIMIT_REGISTRY },
  /*
   * ⚠ And the books' — who put in what, who is owed what. Leave this out and
   * every bookkeeping operation is reachable by anybody signed in.
   */
  { key: 'books', features: BOOKS_FEATURE_REGISTRY },
  /*
   * ⚠ And booking's — every booking carries a customer's name and phone. Leave
   * this out and they are readable by anybody signed in, the resource cap is
   * never mirrored for plans, and the reminders never run.
   */
  {
    key: 'booking',
    features: BOOKING_FEATURE_REGISTRY,
    limits: BOOKING_LIMIT_REGISTRY,
    processes: BOOKING_PROCESS_REGISTRY,
  },
  /*
   * ⚠ And notifications' — including the key that sends AS THE PLATFORM. Leave
   * this out and anybody signed in could send to anybody.
   */
  { key: 'notification', features: NOTIFICATION_FEATURE_REGISTRY },
  /*
   * ⚠ And the Apps page's. Leave this out and anybody signed in could save a
   * layout into, or reset the default of, any workspace they name.
   */
  { key: 'app_hub', features: APP_HUB_FEATURE_REGISTRY },
  /*
   * ⚠ And the background runner's — APP level, held by `super-admin` and
   * nobody else. Leave this out and anybody signed in could pause a process
   * for every organization, or force a run.
   */
  { key: 'jobs', features: JOBS_FEATURE_REGISTRY },
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

/**
 * Every background process the app's modules declare, for `db:sync` to mirror
 * into `job_process` (`seeders/jobs-processes.ts`).
 *
 * ⚠ The runner is handed the SAME processes, with their handlers, composed from
 * the server descriptors in `app.module.ts`. Two lists, because a handler
 * cannot be named without Nest and this file must run without it — so a
 * process added to a module's descriptor and not to its line above is declared,
 * never synced, and never run. The runner names it at its first wake-up.
 *
 * Duplicate keys and incomplete declarations throw, in `composeProcesses`.
 */
export const ALL_PROCESSES: readonly ProcessDeclaration[] = composeProcesses(MODULE_DECLARATIONS);
