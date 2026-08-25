import { authWebModule } from '@kwtech/module-auth/react';
import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { permissionsWebModule } from '@kwtech/module-permissions/react';

/**
 * Every module this app composes, listed once (PLAN §9).
 *
 * Routes, navigation and middleware protection all derive from this array, so
 * adding the tenth module is the same one-line edit as adding the second.
 * Duplicate paths and duplicate feature keys throw at composition time rather
 * than at first request.
 *
 * `module-permissions` contributes /admin/roles, keyed on `admin:access`. The
 * page body is still a Phase 6 stub, but listing it here is what puts a real
 * entry in the side drawer and proves the whole path: descriptor -> composeNav
 * -> grant filter -> rendered link. It is hidden from anyone who does not hold
 * the key, so an unfinished page is not an exposed one.
 */
export const WEB_MODULES: readonly WebModuleDescriptor[] = [authWebModule, permissionsWebModule];
