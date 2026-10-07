/**
 * `@kwtech/module-print/react` — the web half. Imports React, `@kwtech/web-ui`
 * and the pure root; ⚠ never `/server`.
 *
 * ⚠ NAMED exports for what is `'use client'`, never `export *`: a client
 * module does not answer the enumeration `export *` compiles to.
 */

export * from './module.js';
export {
  createPrintTarget,
  type PrintTarget,
  type PrintTargetJob,
  type PrintTargetOptions,
  type PrintTargetOutcome,
  type PrintTargetPrinter,
  type PrintTargetSetting,
} from './print-target.js';
