import { AuthModule, JwtAuthGuard } from '@kwtech/module-auth/server';
import { FeatureGuard, PermissionsModule } from '@kwtech/module-permissions/server';
import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { ThrottlerModule } from '@nestjs/throttler';
import { CredentialThrottlerGuard } from './auth/credential-throttler.guard.js';
import { sendPasswordResetEmail } from './auth/reset-mail.js';
import { resolvePrincipal } from './auth/resolve-principal.js';
import { env } from './config/env.js';
import { graphqlOptions, requestFromContext } from './graphql/graphql.options.js';
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
      /*
       * The tight bucket for endpoints where somebody is GUESSING a secret —
       * sign-in, the 2FA challenge, forgot- and reset-password.
       *
       * Pointed at them by CredentialThrottlerGuard rather than by a @Throttle
       * decorator, because the handlers live in @kwtech/module-auth and that
       * package must not depend on @nestjs/throttler. The module publishes the
       * list; see ./auth/credential-throttler.guard.ts.
       */
      { name: 'credential', ttl: 60_000, limit: 10 },
    ]),

    /*
     * Three things, and every one of them is genuinely this app's:
     *   - which Prisma client the module writes through
     *   - how a reset link actually reaches a person
     *   - where a failed sign-in gets recorded
     *
     * The secret, the issuer/audience and the three TTLs are read by the module
     * from the environment it documents (AUTH_JWT_SECRET and friends). Passing
     * them here would only move the same values through an extra hop — and a
     * missing secret still fails at BOOT, in resolveAuthOptions, rather than at
     * the first sign-in of the day.
     */
    AuthModule.forRoot({
      prismaProvider: authPrismaProvider,
      sendPasswordResetEmail,

      /*
       * THE SAME FUNCTION the permissions module is given below.
       *
       * Authentication and authorisation must agree about who is calling, and
       * two ways of finding the request is two chances for them not to. It is
       * what lets one JwtAuthGuard cover REST, GraphQL and — once subscriptions
       * land — the socket handshake.
       */
      getRequest: requestFromContext,

      /*
       * Passed EXPLICITLY, not left to the module's own AUTH_MFA_ISSUER_LABEL
       * lookup. The fallback to APP_NAME happens in this app's zod schema, and
       * a zod default never reaches `process.env` — so leaving the module to
       * read the variable itself would give it nothing and it would fall back
       * to the token issuer, `kwtech-web-server`, which is what people would
       * then see in their authenticator app.
       */
      mfaIssuerLabel: env.AUTH_MFA_ISSUER_LABEL,
      onAuthFailure: (event) => {
        // The endpoint tells the caller nothing; an operator still needs to
        // tell an unknown address from a locked account. This is where that
        // difference goes — at warn, so a spike of `wrong_password` is
        // alertable without every signed-out page load being noise.
        authFailures.warn(JSON.stringify(event));
      },
    }),

    /*
     * ONE registration, and no module is named in it.
     *
     * Code-first means a module's resolver is just a provider it already
     * declares, so its queries reach the schema by the module being imported —
     * see ./graphql/graphql.options.ts. Adding the tenth module costs nothing
     * here.
     */
    GraphQLModule.forRoot(graphqlOptions()),

    PermissionsModule.forRoot({
      apiPrefix: '/api/v1',

      /*
       * How the guard finds the request, on EITHER transport.
       *
       * `context.switchToHttp()` returns an empty shell for a GraphQL call, so
       * without this the FeatureGuard would resolve nobody on every GraphQL
       * field and refuse everyone. One guard, two transports, one seam.
       */
      getRequest: requestFromContext,
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
    { provide: APP_GUARD, useClass: CredentialThrottlerGuard },
    { provide: APP_GUARD, useExisting: FeatureGuard },
  ],
})
export class AppModule {}
