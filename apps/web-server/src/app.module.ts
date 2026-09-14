import { authServerModule, JwtAuthGuard, TokenService } from '@kwtech/module-auth/server';
import {
  CHAT_DEFAULTS,
  CHAT_LIMIT_CHECKER,
  CHAT_NOTIFIER,
  CHAT_PLATFORM_ADMIN,
  CHAT_PUBSUB,
  CHAT_USER_DIRECTORY,
  ChatPresenceService,
  chatServerModule,
} from '@kwtech/module-chat/server';
import { type ServerModuleDescriptor, serverModuleImports, serverRoutePrefixes } from '@kwtech/module-kit';
import {
  FeatureGuard,
  PERMISSIONS_PUBSUB,
  PermissionsLimitChecker,
  PermissionsService,
  permissionsServerModule,
} from '@kwtech/module-permissions/server';
import {
  QUEUE_LIMIT_CHECKER,
  QUEUE_PUBSUB,
  QUEUE_STAFF_CHECK,
  QUEUE_STAFF_DIRECTORY,
  QUEUE_WORKSPACE_LOCATOR,
  QueueDisplayService,
  queueServerModule,
} from '@kwtech/module-queuing-window/server';
import type { ApolloDriverConfig } from '@nestjs/apollo';
import { Logger, Module, type ModuleMetadata } from '@nestjs/common';
import { APP_GUARD, RouterModule } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { ThrottlerModule } from '@nestjs/throttler';
import { CredentialThrottlerGuard } from './auth/credential-throttler.guard.js';
import { sendPasswordResetEmail } from './auth/reset-mail.js';
import { resolvePrincipal } from './auth/resolve-principal.js';
import { ChatDefaults } from './chat/defaults-reader.js';
import { ChatMailNotifier } from './chat/notify-mail.js';
import { ChatPlatformAdmin } from './chat/platform-admin.js';
import { ChatUserDirectory } from './chat/user-directory.js';
import { env } from './config/env.js';
import { argsFromContext, GRAPHQL_DRIVER, graphqlOptions, requestFromContext } from './graphql/graphql.options.js';
import { HealthController } from './health/health.controller.js';
import { InvitationsResolver } from './invitations/invitations.resolver.js';
import { sendInvitationEmail } from './permissions/invitation-mail.js';
import {
  authPrismaProvider,
  chatPrismaProvider,
  chatWritePrismaProvider,
  permissionsPrismaProvider,
  permissionsWritePrismaProvider,
  queuePrismaProvider,
  queueWritePrismaProvider,
} from './prisma/module-clients.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { QueueStaffAccess } from './queue/staff-check.js';
import { QueueStaffDirectoryAdapter } from './queue/staff-directory.js';
import { QueueWorkspaceLocatorAdapter } from './queue/workspace-locator.js';
import { realtimePubSub } from './realtime/realtime.pubsub.js';
import { NORMAL_USER_KEY } from './seed/app-roles.js';
import { ALL_DEFAULT_MOMENTS, ALL_DEFAULTS, ALL_FEATURES, ALL_LIMITS } from './seed/registry.js';
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
/**
 * Chat's descriptor, HOISTED out of `SERVER_MODULES`.
 *
 * Only because the GraphQL options need the SAME dynamic module object to
 * resolve `ChatPresenceService` — see the `imports` there. Every other module
 * is constructed inline, and this would be too if a socket's lifecycle were not
 * a fact one module cares about.
 *
 * THE FIRST MODULE THAT IS NOT PLATFORM, and the shortest entry here — which is
 * the point of the packaging rule it was designed to. Five ports and a seam,
 * all of them things only this app can answer.
 */
const CHAT_SERVER_MODULE: ServerModuleDescriptor = chatServerModule({
  prismaProvider: chatPrismaProvider,
  prismaWriteProvider: chatWritePrismaProvider,

  /*
   * The directory: an email to a person, and ids to names. Both read
   * `auth_user`, which belongs to another module — see ./chat/user-directory.ts
   * for why the app is the only layer that can host it.
   */
  userDirectoryProvider: {
    provide: CHAT_USER_DIRECTORY,
    inject: [PrismaService],
    useFactory: (prisma: PrismaService) => new ChatUserDirectory(prisma),
  },

  /*
   * ⚠ THE CAP, and binding it is what makes it exist. Omit this line and chat
   * still works — the null object allows everything — which is the design goal
   * and also the hazard: a host that MEANT to enforce the cap and forgot would
   * get silence. It is one explicit line rather than a default for exactly
   * that reason.
   *
   * `useExisting`, not a new instance: the adapter is a provider of the
   * permissions module, which is global, so this is the same object the rest
   * of the app resolves.
   */
  limitCheckerProvider: { provide: CHAT_LIMIT_CHECKER, useExisting: PermissionsLimitChecker },

  /*
   * ⚠ THE SAME ENGINE `module-permissions` PUBLISHES INTO, and that is the
   * whole reason `realtimePubSub()` exists rather than a `new PubSub()` at
   * each binding. Two engines in one process do not see each other's
   * publishes, and the failure is silent — a subscriber waiting forever with
   * no error anywhere.
   *
   * It is also where single-replica is ENFORCED rather than assumed
   * (PLAN §12.28), which matters more for chat than for anything before it: a
   * plan badge arriving late is a stale screen, a message that never arrives
   * is mail that was lost while the sender watched it send.
   */
  pubsubProvider: { provide: CHAT_PUBSUB, useValue: realtimePubSub() },

  /*
   * Principal → userId. The same seam `resolvePrincipal` is, narrowed: chat
   * needs only the id, and handing it the whole principal would let it grow an
   * opinion about what a session is.
   */
  resolveActorId: (request: unknown) => resolvePrincipal(request)?.userId,

  /*
   * ⚠ THE APP LEVEL REACHING DOWN INTO A CONVERSATION — chat's second port
   * that only this layer can fill, beside the directory above.
   *
   * Chat declares `chat:manage_all` and cannot check it: asking whether
   * somebody holds a key is the permissions module's question, and neither may
   * import the other (§9). The implementation is in ./chat/platform-admin.ts —
   * this file composes modules, and twenty lines of permission logic inside a
   * descriptor is how a composition file stops being one.
   */
  platformAdminProvider: {
    provide: CHAT_PLATFORM_ADMIN,
    inject: [PermissionsService],
    useFactory: (permissions: PermissionsService) => new ChatPlatformAdmin(permissions),
  },

  /*
   * ⚠ CHAT DECLARES ITS TWO DEFAULTS AND CANNOT READ THEM. The declaration
   * belongs to chat — they are chat's decisions, about chat's participant roles
   * — and the VALUE lives in `perm_default`, a table `module-permissions` owns.
   * The same split as the cap: chat declares `chat:group_chats` and calls a
   * `LimitChecker` to find out the number.
   */
  /*
   * ⚠ HOW SOMEBODY WITH A CLOSED TAB IS TOLD — §12.50, answered with email.
   *
   * The module decides WHO is owed a nudge and cannot send one: it has no mail
   * server and no idea what an email address is. Same seam as module-auth's
   * reset mail, and it is what keeps Web Push open — a push implementation
   * replaces this provider and changes nothing in the module.
   */
  notifierProvider: {
    provide: CHAT_NOTIFIER,
    inject: [PrismaService],
    useFactory: (prisma: PrismaService) => new ChatMailNotifier(prisma),
  },

  defaultsProvider: {
    provide: CHAT_DEFAULTS,
    inject: [PermissionsService],
    useFactory: (permissions: PermissionsService) => new ChatDefaults(permissions),
  },
});

/**
 * The walk-in queue — the first WORKSPACE-level module that is not permissions.
 * Every port below reads another module's tables, which is why each is here;
 * the adapters are in ./queue/.
 *
 * HOISTED like chat's, and for the same reason: the GraphQL options need the
 * SAME dynamic module object, to resolve `QueueDisplayService` for the socket
 * handshake — see `admitAnonymous` there.
 */
const QUEUE_SERVER_MODULE: ServerModuleDescriptor = queueServerModule({
  prismaProvider: queuePrismaProvider,
  prismaWriteProvider: queueWritePrismaProvider,

  // ⚠ The caps exist because this line does. Omitted, windows are unlimited.
  limitCheckerProvider: { provide: QUEUE_LIMIT_CHECKER, useExisting: PermissionsLimitChecker },

  /*
   * ⚠ Without it, a window can be assigned only to yourself — the module
   * cannot vouch for anybody else's membership or `queue:serve`.
   */
  staffCheckProvider: {
    provide: QUEUE_STAFF_CHECK,
    inject: [PermissionsService],
    useFactory: (permissions: PermissionsService) => new QueueStaffAccess(permissions),
  },
  staffDirectoryProvider: {
    provide: QUEUE_STAFF_DIRECTORY,
    inject: [PermissionsService, PrismaService],
    useFactory: (permissions: PermissionsService, prisma: PrismaService) =>
      new QueueStaffDirectoryAdapter(permissions, prisma, new QueueStaffAccess(permissions)),
  },

  // ⚠ Without it, no display can ever open.
  workspaceLocatorProvider: {
    provide: QUEUE_WORKSPACE_LOCATOR,
    inject: [PrismaService],
    useFactory: (prisma: PrismaService) => new QueueWorkspaceLocatorAdapter(prisma),
  },

  // Principal → userId, the same narrowed seam chat takes.
  resolveActorId: (request: unknown) => resolvePrincipal(request)?.userId,

  /*
   * ⚠ THE SAME ENGINE chat and permissions publish into. A second engine would
   * never see these publishes, and a TV would wait forever with no error.
   */
  pubsubProvider: { provide: QUEUE_PUBSUB, useValue: realtimePubSub() },
});

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
     * The pub/sub engine, which is a DEPLOYMENT fact rather than a module one —
     * so the app supplies it, and every module that publishes takes the same
     * instance from the same place.
     *
     * ⚠ `new PubSub()` used to be written inline here. That was correct for
     * exactly as long as one module published: the next one would have
     * constructed a second engine, and two engines in one process do not see
     * each other's publishes — a subscriber on B waits forever for an event
     * sent on A, with no error. `realtimePubSub()` is the single instance, and
     * it is also where single-replica is ENFORCED rather than assumed
     * (PLAN §12.28). The module depends only on the structural
     * `PermissionsPubSub`, so the eventual swap to Redis changes nothing here
     * or in any resolver (PLAN §7).
     */
    pubsubProvider: { provide: PERMISSIONS_PUBSUB, useValue: realtimePubSub() },

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
     * The same composition, for caps. One module declares them today; the
     * reason it is composed anyway is that the failure when a second one does
     * is invisible — an uncomposed key is dropped out of the resolved map
     * before any check sees it, so the cap reads as "no limit" while the
     * operator's number sits in the database looking enforced.
     */
    limitRegistry: ALL_LIMITS,

    /*
     * ⚠ THE THIRD COMPOSED REGISTRY, and the quietest one to get wrong.
     *
     * The defaults SCREEN lists this, so a default nobody composed has no row
     * to set — and `setDefault` looks a key up in it, so a contributed key is
     * refused as "not a default this build has" while the screen is showing a
     * control for it. Both halves have to read the same catalogue.
     */
    defaultRegistry: ALL_DEFAULTS,

    /*
     * ⚠ And the section HEADINGS, which is the half that decides whether a
     * contributed default is REACHABLE. The screen groups by moment, so a
     * default at a moment nobody named lands in an unnamed section at the
     * bottom — and before these were contributable at all, it landed nowhere
     * and did not render.
     */
    defaultMomentRegistry: ALL_DEFAULT_MOMENTS,

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

  CHAT_SERVER_MODULE,

  QUEUE_SERVER_MODULE,
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
      { name: 'default', ttl: 60_000, limit: env.THROTTLE_DEFAULT_LIMIT },
      /*
       * The tight bucket for endpoints where somebody is GUESSING a secret —
       * sign-in, the 2FA challenge, forgot- and reset-password.
       *
       * Pointed at them by CredentialThrottlerGuard rather than by a @Throttle
       * decorator, because the handlers live in @kwtech/module-auth and that
       * package must not depend on @nestjs/throttler. The module publishes the
       * list; see ./auth/credential-throttler.guard.ts.
       */
      { name: 'credential', ttl: 60_000, limit: env.THROTTLE_CREDENTIAL_LIMIT },
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
      /*
       * ⚠ `imports` IS REQUIRED HERE AND IS EASY TO MISS.
       *
       * `forRootAsync` resolves its `inject` tokens against the DYNAMIC
       * MODULE'S OWN injector, not against this one — so a provider exported by
       * a module that AppModule imports is still invisible to it. `TokenService`
       * happens to resolve because the auth module is global; chat is not, and
       * the failure is at boot with "make sure the argument is available in the
       * GraphQLModule module", which names the symptom rather than the cause.
       *
       * The SAME dynamic module object `SERVER_MODULES` holds — Nest dedupes by
       * reference, so this imports that instance rather than constructing a
       * second one. A second `chatServerModule()` call here would give the
       * socket a presence store nothing else could read, and nothing would
       * report it.
       */
      imports: [
        CHAT_SERVER_MODULE.nestModule as NonNullable<ModuleMetadata['imports']>[number],
        QUEUE_SERVER_MODULE.nestModule as NonNullable<ModuleMetadata['imports']>[number],
      ],
      inject: [TokenService, ChatPresenceService, QueueDisplayService],
      /*
       * ⚠ THE SEAM THAT KEEPS `graphql.options.ts` FREE OF MODULE NAMES.
       *
       * A socket opening and closing is a fact about the transport; what it
       * MEANS — somebody arrived, somebody left — belongs to a module. So the
       * options file takes callbacks and this file, which already knows which
       * modules it composed, supplies them. The same arrangement as
       * `resolvePrincipal` and the user directory.
       *
       * ⚠ And they are fire-and-forget on purpose: a handshake must not fail
       * because a presence store was slow, and `disconnected` is deliberately
       * synchronous — it records the moment and lets the sweep decide, because
       * the grace period is the whole point.
       */
      useFactory: (tokens: TokenService, presence: ChatPresenceService, displays: QueueDisplayService) =>
        graphqlOptions(
          tokens,
          {
            opened: (userId, socketId) => void presence.connected(userId, socketId),
            closed: (userId, socketId) => presence.disconnected(userId, socketId),
            alive: (userId, socketId) => presence.heartbeat(userId, socketId),
          },
          /*
           * ⚠ A SOCKET WITH NO TICKET IS OFFERED TO THE QUEUE: a TV presenting its
           * display pass. What it admits carries no principal, so it reaches the
           * public board and nothing else — see ./graphql/ws-context.ts. Another
           * module wanting anonymous sockets would compose here, keyed on its own
           * connection parameter.
           */
          (params) => displays.admit(params),
        ),
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
