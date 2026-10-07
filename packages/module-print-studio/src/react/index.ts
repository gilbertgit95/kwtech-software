/**
 * `@kwtech/module-print-studio/react` — the web half.
 *
 * A SEPARATE entry point from '.', which stays framework-free. `react` and
 * `@kwtech/web-ui` are optional peers for that reason.
 *
 * ⚠ NAMED exports, never `export *`: part of this barrel is `'use client'`, and
 * a client module does not answer the enumeration `export *` compiles to.
 */

export { studioWebModule } from './module.js';
export {
  type StudioPrinterChoice,
  type StudioPrinterJob,
  type StudioPrinterOutcome,
  type StudioPrinterPort,
  StudioPrinterProvider,
  type StudioPrinterSetting,
} from './printer-port.js';
export { StudioApp } from './studio-app.js';
