import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { AUTH_FEATURE_REGISTRY } from '../features.js';
import { AuthModule } from './auth.module.js';
import type { AuthModuleOptions } from './auth.options.js';

/**
 * The module's SERVER descriptor — the counterpart to `authWebModule`.
 *
 * The web side has always composed:
 *
 *   const WEB_MODULES = [authWebModule, permissionsWebModule];
 *
 * The server side did not. An app hand-wrote `AuthModule.forRoot({...})` into
 * its `imports` array, so adopting a module on the server was a different shape
 * of edit from adopting one on the web — and the tenth module was ten hand-
 * written entries rather than a list.
 *
 *   const SERVER_MODULES = [authServerModule({ ... }), permissionsServerModule({ ... })];
 *
 *   @Module({
 *     imports: [PrismaModule, ...serverModuleImports(SERVER_MODULES)],
 *   })
 *
 * ## No routePrefix
 *
 * `AuthController` is `@Controller('auth')` and the app sets a global prefix, so
 * its routes already land at `/api/v1/auth/*`. Passing a prefix here would nest
 * it a second time. The option stays available for an app that mounts auth
 * somewhere else.
 *
 * ## Features
 *
 * Carried from `AUTH_FEATURE_REGISTRY`, so anything composing from a list of
 * server descriptors sees this module's rights. It did NOT, and that was a bug
 * waiting: `permissionsServerModule` passed its registry while this one passed
 * nothing, so the day auth declared a key it would have been silently absent
 * from every consumer that trusted the descriptor. It only went unnoticed
 * because the seeder reads the registries directly.
 *
 * The list was legitimately EMPTY for a long time — signing in is not a
 * grantable right, and the settings pages need a session rather than
 * authorisation — and carrying it anyway is what made declaring the first real
 * key a one-line change here rather than a discovery. It now carries twelve:
 * three `account:*` rights over your own data, and the nine `users:*` rights
 * over somebody else's.
 */
export function authServerModule(options: AuthModuleOptions & { routePrefix?: string }): ServerModuleDescriptor {
  const { routePrefix, ...moduleOptions } = options;

  return {
    key: 'auth',
    nestModule: AuthModule.forRoot(moduleOptions),
    ...(routePrefix !== undefined ? { routePrefix } : {}),
    features: AUTH_FEATURE_REGISTRY,
  };
}
