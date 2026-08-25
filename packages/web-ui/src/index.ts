/**
 * @kwtech/web-ui — the component vocabulary shared by every web app.
 *
 * Scope rule: anything in here must be useful to more than one app. A
 * component with exactly one consumer belongs in that app until a second one
 * needs it — extracting early is how component libraries end up full of
 * abstractions nobody wanted.
 *
 * Platform rule: this package is React DOM. When mobile-ui arrives, the parts
 * that are genuinely platform-neutral — design tokens, formatters, validation
 * schemas — move out to a shared package rather than being duplicated.
 *
 * The themes themselves are CSS and are imported by path:
 *   @import "@kwtech/web-ui/themes/all.css";
 */
export {
  applyPalette,
  PALETTE_ATTRIBUTE,
  PALETTE_STORAGE_KEY,
  palettePreloadScript,
  readStoredPalette,
} from './palette-runtime.js';
export { DEFAULT_PALETTE, isPalette, PALETTES, type PaletteOption } from './palettes.js';
