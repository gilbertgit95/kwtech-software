import { type FeatureMode, REQUIRED_FEATURES, REQUIRED_FEATURES_MODE } from '@kwtech/module-kit';
import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '../types.js';

/*
 * The metadata KEYS live in `@kwtech/module-kit` — see feature-metadata.ts
 * there for why. They are re-exported here because every call site in this
 * module and in the app already imports them from this path, and because a
 * reader looking for "what does the guard read" should find it beside the
 * decorator that writes it.
 */
export { type FeatureMode, REQUIRED_FEATURES, REQUIRED_FEATURES_MODE };

/**
 * Declares the rights a handler needs, next to the handler itself.
 *
 *   @RequireFeature(FEATURE.usersWrite)
 *   @Post(':id/disable')
 *
 * Defaults to 'all' because that is the safe reading of a list: asking for two
 * keys and silently accepting one is how over-permissive endpoints happen.
 *
 * Narrowed to `FeatureKey`, unlike the twin in `module-auth`: this module owns
 * the registry, so here a mistyped key is a compile error. A module declaring
 * its OWN rights cannot be held to that — its keys are not in this union — so
 * it takes strings and the seed's registry check catches an unknown one.
 */
export const RequireFeature = (...features: FeatureKey[]) => SetMetadata(REQUIRED_FEATURES, features);

/** Opt into OR semantics for the keys declared above. */
export const RequireFeatureMode = (mode: FeatureMode) => SetMetadata(REQUIRED_FEATURES_MODE, mode);
