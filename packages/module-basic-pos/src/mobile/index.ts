/**
 * `@kwtech/module-basic-pos/mobile` — the point of sale on the phone layout
 * (issue #22): one app, its sections in the phone's strip (Sell, for now).
 *
 * Browser code, like `/react`: never `/server` (`pnpm check:boundaries`).
 * ⚠ NAMED exports: these are `'use client'` modules.
 */
export { posMobileModule } from './module.js';
export { PosMobileApp } from './pos-mobile-app.js';
export { POS_MOBILE_SECTION } from './sections.js';
