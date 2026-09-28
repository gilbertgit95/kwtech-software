/**
 * `@kwtech/module-task/react` — the web half.
 *
 * A SEPARATE entry point from '.', which stays framework-free. `react` and
 * `@kwtech/web-ui` are optional peers for that reason.
 *
 * ⚠ NAMED exports, never `export *`: part of this barrel is `'use client'`, and
 * a client module does not answer the enumeration `export *` compiles to.
 */

export { taskWebModule } from './module.js';
export { TaskApp } from './task-app.js';
export { createTaskClient, DEFAULT_GRAPHQL_PATH, type TaskClient } from './task-client.js';
