import { authServerModule, JwtAuthGuard, TokenService } from '@kwtech/module-auth/server';
import { type ServerModuleDescriptor, serverModuleImports, serverRoutePrefixes } from '@kwtech/module-kit';
import { FeatureGuard, PERMISSIONS_PUBSUB, permissionsServerModule } from '@kwtech/module-permissions/server';
import type { ApolloDriverConfig } from '@nestjs/apollo';
import { Logger, Module, type ModuleMetadata } from '@nestjs/common';
import { APP_GUARD, RouterModule } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { ThrottlerModule } from '@nestjs/throttler';
import { PubSub } from 'graphql-subscriptions';
import { CredentialThrottlerGuard } from './auth/credential-throttler.guard.js';
import { sendPasswordResetEmail } from './auth/reset-mail.js';
import { resolvePrincipal } from './auth/resolve-principal.js';
import { env } from './config/env.js';
import { argsFromContext, GRAPHQL_DRIVER, graphqlOptions, requestFromContext } from './graphql/graphql.options.js';
import { HealthController } from './health/health.controller.js';
import { InvitationsResolver } from './invitations/invitations.resolver.js';
import { sendInvitationEmail } from './permissions/invitation-mail.js';
import {
  authPrismaProvider,
  permissionsPrismaProvider,
  permissionsWritePrismaProvider,
} from './prisma/module-clients.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { NORMAL_USER_KEY } from './seed/app-roles.js';
import { ALL_FEATURES } from './seed/registry.js';
import { UsersResolver } from './users/users.resolver.js';

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

/**
 * EVERY MODULE THIS SERVER COMPOSES, listed once. ← add yours here
 *
 * The mirror of `WEB_MODULES` in the web app, and it did not exist until now:
 * this file hand-wrote `AuthModule.forRoot({...})` and
 * `PermissionsModule.forRoot({...})` straight into `imports`, so adopting a
 * module on the server was a different shape of edit from adopting one on the
 * web — and `permissionsServerModule()` sat in the package, tested and unused.
 *
 * What each module needs from THIS app still lives here, because it genuinely
 * is this app's: which Prisma client it writes through, how a reset link reaches
 * a person, and the one function that lets authentication and authorisation
 * agree about who is calling. Everything mechanical — the DynamicModule, the
 * route prefix, the feature contributions — comes off the descriptor.
 */
const SERVER_MODULES: readonly ServerModuleDescriptor[] = [
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
  authServerModule({
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

  permissionsServerModule({
    apiPrefix: '/api/v1',

    /*
     * The role every new account gets when its invitation named none.
     *
     * Named HERE because this app seeds the roles — `seed/app-roles.ts` defines
     * `normal-user` and the module has never heard of it, which is the whole
     * reason this is configuration rather than a constant over there.
     *
     * It matters because the permission model is additive: an account with no
     * app-level role holds NOTHING, since the seeded organization roles carry
     * no features either, and it lands on a settings page whose Save button is
     * hidden. That is not hypothetical — an account created by an organization
     * invitation was in exactly that state.
     *
     * `normal-user` is the smallest thing that is still an answer: the three
     * `account:*` keys, which is managing your own profile and nothing else.
     */
    defaultAppRoleKey: NORMAL_USER_KEY,

    /*
     * How an invitation link reaches the person invited — the app's job, for
     * the same reason `sendPasswordResetEmail` is, one module over. The module
     * mints and hashes the token and hands the raw value to this once; it has
     * no email transport and knows nothing about the frontend route the link
     * points at.
     *
     * REQUIRED rather than optional: without it `inviteMember` refuses before
     * writing anything, which beats a pending invitation nobody can ever
     * accept.
     */
    sendInvitationEmail,

    /*
     * The pub/sub engine, chosen HERE because it is a deployment fact rather
     * than a module one.
     *
     * `graphql-subscriptions`' in-memory PubSub serves ONE API instance — a
     * publish reaches only the subscribers connected to this process. The
     * moment `apps/web-server` runs more than one replica, an event published
     * on replica A never reaches a socket held by replica B, and the failure is
     * silent: the UI simply does not update for half the users. Swap in
     * `graphql-redis-subscriptions` at that point; the module depends on the
     * structural `PermissionsPubSub` and nothing in it changes (PLAN §7).
     */
    pubsubProvider: { provide: PERMISSIONS_PUBSUB, useValue: new PubSub() },

    /*
     * EVERY module's features, not just this module's own.
     *
     * The same composed list the seeder writes to `perm_feature`, so what a
     * role may be GIVEN and what exists in the table are the same set by
     * construction. Without it the module validates against its own registry
     * alone, and `module-auth`'s three `account:*` keys — registered, granted,
     * undeprecated — are refused as "not in the registry" by every role write.
     *
     * Composed here because neither module may import the other (PLAN §9).
     * Same seam as `resolvePrincipal`.
     */
    featureRegistry: ALL_FEATURES,

    /*
     * How the guard finds the request, on EITHER transport.
     *
     * `context.switchToHttp()` returns an empty shell for a GraphQL call, so
     * without this the FeatureGuard would resolve nobody on every GraphQL
     * field and refuse everyone. One guard, two transports, one seam.
     */
    getRequest: requestFromContext,
    /*
     * The other half of the seam, and the line the whole `/organizations/*`
     * area rests on (PLAN §12.13).
     *
     * `getRequest` says who is calling; this says WHERE. A resolver has no
     * path, so without it the guard falls back to parsing `/api/v1/graphql`
     * and resolves app level with no organization — and every
     * ORGANIZATION-LEVEL key then grants nothing, for everyone, silently.
     * `@RequireScope` had been written and tested and could not work until
     * this existed.
     */
    getArgs: argsFromContext,
    prismaProvider: permissionsPrismaProvider,
    prismaWriteProvider: permissionsWritePrismaProvider,

    /**
     * THE SEAM — see ./auth/resolve-principal.ts, where it is documented and
     * tested. Kept out of the decorator because an inline arrow there is the
     * one thing in the app that most deserves a test and least admits one.
     */
    resolvePrincipal,
  }),
];

/**
 * Mounts any module that asked for a prefix, via Nest's RouterModule.
 *
 * Empty today — `AuthController` is `@Controller('auth')` under a global
 * `/api/v1`, and the permissions controller does its own — so this registers
 * nothing and costs nothing. It is here so that adopting a module which DOES
 * want a prefix is still one line in SERVER_MODULES.
 *
 * The cast narrows `module: unknown` to Nest's `Type<any>`. module-kit types it
 * loosely on purpose — it carries Nest modules as opaque values so it never
 * imports Nest — and the app is the layer that already does, which is exactly
 * where the narrowing belongs. Same arrangement as `requestFromContext` in
 * ./graphql/graphql.options.ts.
 */
const ROUTE_PREFIXES = serverRoutePrefixes(SERVER_MODULES) as Parameters<typeof RouterModule.register>[0];

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
     * ONE registration, and no module is named in it.
     *
     * Code-first means a module's resolver is just a provider it already
     * declares, so its queries reach the schema by the module being imported —
     * see ./graphql/graphql.options.ts. Adding the tenth module costs nothing
     * here.
     */
    /*
     * `forRootAsync`, because the WebSocket handshake needs the app's
     * `TokenService` to verify a ticket — see graphql.options.ts. That is the
     * one thing GraphQL configuration cannot derive for itself: authentication
     * belongs to `@kwtech/module-auth`, and injecting it keeps this file from
     * importing a verifier of its own. One issuer, one verification path, for
     * REST, GraphQL and the socket alike (§12.8).
     */
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      // Asserted BEFORE the factory runs, so it cannot come from inside it.
      driver: GRAPHQL_DRIVER,
      inject: [TokenService],
      useFactory: (tokens: TokenService) => graphqlOptions(tokens),
    }),

    /*
     * Every module in SERVER_MODULES, in one line. Adding the tenth is an entry
     * in that array and nothing in this decorator.
     *
     * The cast is the same narrowing as ROUTE_PREFIXES below and for the same
     * reason: `serverModuleImports` returns `unknown[]` because module-kit
     * carries Nest modules as opaque values so it never imports Nest. The app
     * is the layer that already depends on Nest, so the narrowing belongs here.
     */
    ...(serverModuleImports(SERVER_MODULES) as ModuleMetadata['imports'] & unknown[]),
    ...(ROUTE_PREFIXES.length > 0 ? [RouterModule.register(ROUTE_PREFIXES)] : []),
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

    /*
     * The one resolver this app owns, rather than composing from a module.
     *
     * It exists because turning an email into a userId needs `auth_user` (which
     * module-auth owns) AND a permissions key to guard it (which
     * module-permissions owns), and neither module may import the other. The
     * app is the only layer that already depends on both — the same reason
     * `resolvePrincipal` lives here. See ./users/users.resolver.ts.
     */
    UsersResolver,
    /*
     * Accepting an invitation, including from somebody with no account yet.
     * Composes AuthService with PermissionsWriteService — which is why it is
     * here and not in either module (PLAN §9).
     */
    InvitationsResolver,
  ],
})
export class AppModule {}
