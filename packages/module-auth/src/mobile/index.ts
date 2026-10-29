/**
 * `@kwtech/module-auth/mobile` — account settings on the phone layout (issue #22).
 *
 * Browser code, like `/react`: it may import this package's root and `/react`
 * parts, `@kwtech/module-kit` and `@kwtech/web-ui`, and never `/server`
 * (`pnpm check:boundaries`).
 *
 * ⚠ NAMED exports, never `export *`: these are `'use client'` modules.
 */
export { DisplayMobilePanel, PasswordMobilePanel, ProfileMobilePanel } from './account-mobile.js';
