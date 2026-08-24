import { AuthModule, JwtAuthGuard } from '@kwtech/module-auth/server';
import { FeatureGuard, PermissionsModule } from '@kwtech/module-permissions/server';
import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { sendPasswordResetEmail } from './auth/reset-mail.js';
import { resolvePrincipal } from './auth/resolve-principal.js';
import { env } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import {
  authPrismaProvider,
  permissionsPrismaProvider,
  permissionsWritePrismaProvider,
} from './prisma/module-clients.js';
import { PrismaModule } from './prisma/prisma.module.js';

/**
 * The whole application, as a list of modules and the four lines that connect
 * them.
 *
 * ── the seam ───────────────────────────────────────────────────────────────
 *
 * `@kwtech/module-auth` and `@kwtech/module-permissions` do not import each
 * other and know nothing of each other. They meet exactly once, in
 * `resolvePrincipal` below: auth verifies a token and leaves a Principal on the
 * request; permissions reads the `userId` off it and answers against its own
 * tables, which hold that id as a bare string with no foreign key.
 *
 * That is what buys the properties PLAN §12.12 was protecting. Swapping to
 * "Sign in with Google" later changes this file and nothing in either module;
 * the two could sit on different databases; and an app that wants permissions
 * without this auth simply supplies a different resolvePrincipal.
 */
const authFailures = new Logger('AuthFailure');

@Module({
  imports: [
    PrismaModule,

    /**
     * Per-IP limits. The other half of the per-account lockout inside
     * AuthService: lockout alone lets an attacker deny service to a NAMED
     * person, and an IP limit alone lets a botnet spread guesses across
     * accounts. Neither is sufficient; both together are.
     */
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
      // Named, so a credential endpoint can opt into the tighter bucket with
      // @Throttle({ credential: {} }) without changing the global one.
      { name: 'credential', ttl: 60_000, limit: 10 },
    ]),

    AuthModule.forRoot({
      jwtSecret: env.JWT_SECRET,
      issuer: 'kwtech-web-server',
      audience: 'kwtech-api',
      sessionTtl: env.AUTH_SESSION_TTL,
      accessTokenTtl: env.AUTH_ACCESS_TOKEN_TTL,
      passwordResetTtl: env.AUTH_PASSWORD_RESET_TTL,
      prismaProvider: authPrismaProvider,
      sendPasswordResetEmail,
      onAuthFailure: (event) => {
        // The endpoint tells the caller nothing; an operator still needs to
        // tell an unknown address from a locked account. This is where that
        // difference goes — at warn, so a spike of `wrong_password` is
        // alertable without every signed-out page load being noise.
        authFailures.warn(JSON.stringify(event));
      },
    }),

    PermissionsModule.forRoot({
      apiPrefix: '/api/v1',
      prismaProvider: permissionsPrismaProvider,
      prismaWriteProvider: permissionsWritePrismaProvider,

      /**
       * THE SEAM — see ./auth/resolve-principal.ts, where it is documented and
       * tested. Kept out of this file because an inline arrow in a decorator is
       * the one thing in the app that most deserves a test and least admits
       * one.
       */
      resolvePrincipal,
    }),
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: guards run in registration order, so a caller is
    // identified, then rate-limited, then authorised. Authorising an
    // unidentified request would be answering a question about nobody.
    //
    // `useExisting`, not `useClass`. useClass would construct a SECOND instance
    // of each guard in this module's injector — where `Reflector` is not
    // provided, because Nest only auto-provides it in the root injector and
    // each module supplies its own. The guards these modules already export are
    // fully wired; this just points APP_GUARD at them.
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: FeatureGuard },
  ],
})
export class AppModule {}
