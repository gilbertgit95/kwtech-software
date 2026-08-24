/**
 * @kwtech/module-permissions — the pure core.
 *
 * Types, the feature registry and the decision logic. Depends on nothing, so a
 * server app, a worker, the CLI, a React component and a test all import the
 * same vocabulary. Framework-bound layers sit behind subpaths:
 *
 *   import { hasFeature, FEATURE } from '@kwtech/module-permissions';
 *   import { PermissionsModule } from '@kwtech/module-permissions/server';
 *   import { FeatureGate } from '@kwtech/module-permissions/react';
 */
export * from './types.js';
export * from './check.js';
export * from './feature-keys.js';
export * from './domain/index.js';
export * from './registry-audit.js';
export * from './scope.js';
