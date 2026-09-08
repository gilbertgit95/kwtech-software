import { type FeatureMode, REQUIRED_FEATURES, REQUIRED_FEATURES_MODE } from '@kwtech/module-kit';
import { SetMetadata } from '@nestjs/common';
import type { AuthFeatureKey } from '../features.js';

/**
 * Declares the rights a handler in THIS module needs.
 *
 * ## Why this module has its own
 *
 * `@kwtech/module-permissions` has the same three lines, and neither module may
 * import the other (PLAN §9). What must not fork is the metadata KEY, and it
 * does not: both wrap the constants in `@kwtech/module-kit`, which is the
 * package both already depend on and where that contract now lives.
 *
 * The alternative — hosting these resolvers in the app so they could use the
 * permissions decorator — is what `users.resolver.ts` does for the two lookups
 * that are genuinely joint work. It is the wrong shape for a whole feature: the
 * pages, the client, the service and the tables are all here, and only the
 * declaration of who may call them would have been over there, where nothing
 * else about user administration lives.
 *
 * ## What still lives in permissions
 *
 * The enforcement. `FeatureGuard` reads this metadata, resolves the caller's
 * grants and refuses — this module writes a requirement and has no idea how it
 * is met. An app that composes this module without a permissions module has
 * handlers that declare a right nothing checks, which is why the guard is wired
 * as a global `APP_GUARD` in the app rather than assumed here.
 *
 * ## Typed to this module's keys
 *
 * `AuthFeatureKey`, not `string`: these handlers may only require rights this
 * module declares in `features.ts`, so a typo is a compile error and a handler
 * cannot quietly demand a permissions key that no auth role would carry.
 */
export const RequireAuthFeature = (...features: AuthFeatureKey[]) => SetMetadata(REQUIRED_FEATURES, features);

/** Opt into OR semantics. Defaults to 'all', for the reason permissions gives. */
export const RequireAuthFeatureMode = (mode: FeatureMode) => SetMetadata(REQUIRED_FEATURES_MODE, mode);
