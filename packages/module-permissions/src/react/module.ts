import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { FEATURE, FEATURE_REGISTRY } from '../feature-keys.js';
import { RolesPage } from './pages/roles-page.js';

/**
 * The module's web descriptor — routes, navigation and feature contributions as
 * data, so the app composes rather than transcribes.
 *
 *   const WEB_MODULES = [permissionsWebModule, usersWebModule];
 *
 * From that one list the app derives its navigation, its middleware protection
 * and its rendered routes. Nothing here is permissions-specific machinery:
 * every module-* package exports exactly this shape.
 */
export const permissionsWebModule: WebModuleDescriptor = {
  key: 'permissions',
  features: FEATURE_REGISTRY,
  routes: [
    {
      path: '/admin/roles',
      component: RolesPage,
      title: 'Roles',
      // The same key gates the nav entry, the middleware and the page body —
      // one declaration, so a link can never outlive the permission behind it.
      feature: FEATURE.adminAccess,
      nav: { group: 'Administration', order: 10 },
    },
  ],
};
