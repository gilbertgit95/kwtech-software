import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AUTH_OPTIONS, type AuthModuleOptions, resolveAuthOptions } from './auth.options.js';
import { AuthService } from './auth.service.js';
import { AuthResolver } from './graphql/auth.resolver.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { InMemoryRevocationStore, SESSION_REVOCATION_STORE } from './revocation.js';
import { TokenService } from './token.service.js';

/**
 * Wire once per server app:
 *
 *   AuthModule.forRoot({ prismaProvider: { provide: AUTH_PRISMA, useExisting: PrismaService } })
 *
 * The secret and the TTLs come from the environment (`AUTH_JWT_SECRET` and
 * friends) unless passed here, and a missing secret throws at boot rather than
 * defaulting to one every forgetful deployment would share. Only the Prisma
 * binding has no sensible default, because the database client is the app's.
 * Add `sendPasswordResetEmail` before enabling forgot-password — without it
 * that endpoint refuses rather than minting a token nobody can receive.
 *
 * then apply JwtAuthGuard globally with APP_GUARD. Global on purpose:
 * authentication is opt-out (@Public), so a handler nobody annotated is
 * protected rather than anonymous.
 */
@Module({})
export class AuthModule {
  static forRoot(options: AuthModuleOptions): DynamicModule {
    // Resolved here rather than at first use: a missing secret must stop the
    // app booting, not surface as the first sign-in of the day failing.
    const resolved = resolveAuthOptions(options);

    const exposeRest = options.expose?.rest ?? true;
    const exposeGraphql = options.expose?.graphql ?? true;

    const providers: Provider[] = [
      { provide: AUTH_OPTIONS, useValue: resolved },
      // Nest auto-provides Reflector in the ROOT injector, not in a dynamic
      // module's own. JwtAuthGuard reads decorator metadata through it, so
      // without this line the container cannot construct the guard and the app
      // fails at boot with "can't resolve dependencies of the JwtAuthGuard".
      // Listed rather than imported: importing @nestjs/core's module graph to
      // obtain one helper is a heavier dependency than providing it.
      Reflector,
      TokenService,
      AuthService,
      JwtAuthGuard,
    ];
    if (options.prismaProvider) providers.push(options.prismaProvider);

    /*
     * On by default. An app that never scales past one node should not have to
     * run Redis to get correct sign-out, and the alternative to a default is no
     * revocation at all — which is a security property lost to an omission.
     *
     * `null` disables it explicitly, which is the only way to end up without one.
     */
    if (options.revocationStore !== null) {
      providers.push({
        provide: SESSION_REVOCATION_STORE,
        useValue: options.revocationStore ?? new InMemoryRevocationStore(),
      });
    }
    // A resolver is just a provider: listing it here is what puts `viewer` and
    // `session` into the app's code-first schema. Nothing to stitch.
    if (exposeGraphql) providers.push(AuthResolver);

    return {
      module: AuthModule,
      controllers: exposeRest ? [AuthController] : [],
      providers,
      exports: [AuthService, TokenService, JwtAuthGuard, AUTH_OPTIONS, SESSION_REVOCATION_STORE],
      global: true,
    };
  }
}
