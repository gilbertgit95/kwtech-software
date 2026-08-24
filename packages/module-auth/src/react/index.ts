/**
 * @kwtech/module-auth/react — the pages and the client.
 *
 * May import the core, never `/server` (PLAN §9 rule 3). That rule is what
 * keeps node:crypto and the JWT secret out of the browser bundle.
 */
export * from './auth-client.js';
export * from './auth-shell.js';
export * from './forgot-password-page.js';
export * from './module.js';
export * from './reset-password-page.js';
export * from './sign-in-page.js';
export * from './use-auth-form.js';
