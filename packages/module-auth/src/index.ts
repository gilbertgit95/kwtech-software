/**
 * @kwtech/module-auth — the pure core.
 *
 * The shared vocabulary and the policy decisions, with no framework and no node
 * builtins, so this entrypoint is safe in a browser bundle. Everything that
 * needs crypto, a database or Nest sits behind a subpath:
 *
 *   import { normaliseEmail, type Principal } from '@kwtech/module-auth';
 *   import { AuthModule } from '@kwtech/module-auth/server';
 *   import { SignInPage } from '@kwtech/module-auth/react';
 */

export * from './domain/index.js';
export * from './features.js';
export * from './types.js';
