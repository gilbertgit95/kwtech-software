import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '../types.js';

export const REQUIRED_FEATURES = 'kwtech:required-features';
export const REQUIRED_FEATURES_MODE = 'kwtech:required-features-mode';

export type FeatureMode = 'all' | 'any';

/**
 * Declares the rights a handler needs, next to the handler itself.
 *
 *   @RequireFeature(FEATURE.usersWrite)
 *   @Post(':id/disable')
 *
 * Defaults to 'all' because that is the safe reading of a list: asking for two
 * keys and silently accepting one is how over-permissive endpoints happen.
 */
export const RequireFeature = (...features: FeatureKey[]) => SetMetadata(REQUIRED_FEATURES, features);

/** Opt into OR semantics for the keys declared above. */
export const RequireFeatureMode = (mode: FeatureMode) => SetMetadata(REQUIRED_FEATURES_MODE, mode);
