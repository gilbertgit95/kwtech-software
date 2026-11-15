/**
 * `@kwtech/module-file-manager/react` — the web half.
 *
 * A SEPARATE entry point from '.', which stays framework-free; it never
 * imports `/server`. ⚠ NAMED exports, never `export *`: part of this barrel is
 * `'use client'`.
 */

export { FileApp, type FileAppProps } from './file-app.js';
export { createFileClient, type FileClient } from './file-client.js';
export { fileWebModule } from './module.js';
