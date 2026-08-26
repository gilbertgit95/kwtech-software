/**
 * The module's DI token, in a file that imports NOTHING.
 *
 * ## Why it does not live in permissions.module.ts
 *
 * `permissions.module.ts` imports every provider it registers — the guard, the
 * services, the resolver — and each of those needs this token to declare
 * `@Inject(PERMISSIONS_OPTIONS)`. Importing it back from the module closes a
 * cycle, and a cycle around a `const` is not the harmless kind: ESM gives the
 * second file a live binding that is still in its temporal dead zone while the
 * first is mid-evaluation, so the decorator runs with `undefined` as its token.
 *
 * Nest then fails at BOOT with
 *
 *   Nest can't resolve dependencies of the PermissionsResolver (?, PermissionsService)
 *
 * naming the position but not the cause, and suggesting `import type` — which is
 * the opposite of the problem. It cost a debugging session when the resolver was
 * wired up; `FeatureGuard` had survived the same cycle only by an accident of
 * evaluation order, which is not a property worth relying on twice.
 *
 * A leaf module has no such window: nothing it imports can be mid-evaluation,
 * because it imports nothing.
 */
export const PERMISSIONS_OPTIONS = 'kwtech:permissions-options';
