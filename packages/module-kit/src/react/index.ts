/**
 * `@kwtech/module-kit/react` — the React bindings for the status channel.
 *
 * A SEPARATE entry point from '.', so the root export stays runtime-free: a
 * Nest app importing `composeFeatures` pulls in no React, which is the property
 * that let react stay an optional peer dependency of this package.
 */

export {
  FeatureAccessProvider,
  useHeldFeatures,
  useHoldsAllFeatures,
  useHoldsFeature,
} from './feature-access.js';
export {
  PublishStatus,
  type PublishStatusProps,
  StatusProvider,
  type StatusProviderProps,
  useStatusChannel,
  useStatusMessages,
} from './status-context.js';
