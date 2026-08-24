import { authWebModule } from '@kwtech/module-auth/react';
import type { WebModuleDescriptor } from '@kwtech/module-kit';

/**
 * Every module this app composes, listed once (PLAN §9).
 *
 * Routes, navigation and middleware protection all derive from this array, so
 * adding the tenth module is the same one-line edit as adding the second.
 * Duplicate paths and duplicate feature keys throw at composition time rather
 * than at first request.
 *
 * `module-permissions` contributes no web routes yet — its RolesPage arrives in
 * Phase 6 — so only auth is listed.
 */
export const WEB_MODULES: readonly WebModuleDescriptor[] = [authWebModule];
