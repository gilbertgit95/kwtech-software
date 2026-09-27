/**
 * `@kwtech/module-note/react` — the web half.
 *
 * A SEPARATE entry point from '.', which stays framework-free. `react` and
 * `@kwtech/web-ui` are optional peers for that reason.
 *
 * ⚠ NAMED exports, never `export *`: part of this barrel is `'use client'`, and
 * a client module does not answer the enumeration `export *` compiles to.
 */

export { noteWebModule } from './module.js';
export { NoteApp } from './note-app.js';
