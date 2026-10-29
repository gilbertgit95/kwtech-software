/**
 * `@kwtech/module-notification/mobile` — the inbox on the phone layout (issue #22).
 *
 * Browser code, like `/react`: it may import this package's root and `/react`
 * parts, `@kwtech/module-kit` and `@kwtech/web-ui`, and never `/server`
 * (`pnpm check:boundaries`).
 *
 * ⚠ NAMED exports, never `export *`, as in `/react`: these are `'use client'`
 * modules, and a client module does not answer the enumeration `export *`
 * compiles to.
 */
export { InboxMobileBadge } from './inbox-mobile-badge.js';
export { InboxMobileView } from './inbox-mobile-view.js';
export { notificationMobileModule } from './module.js';
