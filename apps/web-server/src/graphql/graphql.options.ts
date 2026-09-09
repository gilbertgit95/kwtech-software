import { join } from 'node:path';
import type { TokenService } from '@kwtech/module-auth/server';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { env } from '../config/env.js';
import {
  authenticateConnection,
  closeWhenAuthorizationExpires,
  connectionContext,
  rememberConnection,
} from './ws-context.js';

/**
 * The one place this app configures GraphQL.
 *
 * ## Why there is nothing here about modules
 *
 * CODE-FIRST, and that is what keeps §9's module pattern intact. A resolver is
 * an ordinary Nest provider: `PermissionsModule.forRoot()` lists
 * `PermissionsResolver` when `expose.graphql` is on, and its queries appear in
 * the composed schema because the driver walks the container. There is no SDL to
 * stitch, no `typeDefs` array to append to, and nothing in this file names a
 * module. Adding the tenth module contributes its queries the same way the
 * second did — by being imported.
 *
 * ## The schema is a build output
 *
 * `autoSchemaFile` writes `schema.graphql` at boot. PLAN §6 makes that a
 * contract the frontend generates types from, which is why it lands at the
 * package root rather than in `dist/` — it is checked in and diffed, so a
 * resolver change that alters the public schema shows up in review rather than
 * in a frontend build three days later.
 */

/** The GraphQL endpoint, under the same prefix as every REST route. */
export const GRAPHQL_PATH = 'graphql';

/**
 * The driver, exported because `forRootAsync` demands it OUTSIDE the factory.
 *
 * Nest asserts the driver before it ever calls `useFactory`, so returning it
 * from `graphqlOptions()` is not enough — the boot fails with "Missing driver
 * option" and a migration-guide link that has nothing to do with the cause.
 * Naming it here keeps this file the single place GraphQL is configured, rather
 * than having app.module.ts import ApolloDriver for one line.
 */
export const GRAPHQL_DRIVER = ApolloDriver;

/**
 * Pulls the underlying HTTP request out of EITHER kind of execution context.
 *
 * Handed to `PermissionsModule` as `getRequest`, and this is the seam that
 * makes one `FeatureGuard` work for both transports. `context.switchToHttp()`
 * returns an empty shell for a GraphQL call — no headers, no principal — so a
 * guard using it would resolve nobody and refuse everyone, or worse, resolve
 * `undefined` and be asked to treat that as anonymous.
 *
 * `getType()` is checked rather than assumed: a subscription resolves through
 * the same guard and its "request" is the connection context, not an HTTP one.
 */
export function requestFromContext(context: unknown): unknown {
  // `unknown` because that is how PermissionsModuleOptions types the hook — the
  // module declines to make @nestjs/common part of its options surface. Narrowed
  // here, in the app, which is the layer that already depends on Nest.
  const ctx = context as ExecutionContext;
  if (ctx.getType<'graphql'>() === 'graphql') {
    return GqlExecutionContext.create(ctx).getContext().req;
  }
  return ctx.switchToHttp().getRequest();
}

/**
 * Pulls a RESOLVER'S ARGUMENTS out of an execution context.
 *
 * Handed to `PermissionsModule` as `getArgs`, and it is the other half of the
 * seam above: `getRequest` says WHO is calling, this says WHERE they are
 * calling about.
 *
 * ## Why it has to exist, and why nothing worked without it
 *
 * A resolver has no path. One GraphQL endpoint serves every operation, so
 * `FeatureGuard`'s fallback — `parseScope(request.url)` — reads
 * `/api/v1/graphql` and resolves APP level with no organization, whatever the
 * arguments say. `@RequireScope` exists precisely so a resolver can declare its
 * level and name the arguments carrying the ids; the guard reads them through
 * THIS hook.
 *
 * It was never wired, which is why the decorator had been written, tested, and
 * used on nothing. The consequence was not a missing feature but a silent one:
 * every organization-level key resolved against a context with no organization
 * in it, so an ORGANIZATION-LEVEL ROLE GRANTED NOTHING — and the refusal read
 * as an ordinary "requires members:manage" at somebody who held
 * `members:manage`. See PLAN.md §12.13.
 *
 * ## Why the app supplies it rather than the module
 *
 * `GqlExecutionContext` is `@nestjs/graphql`, an OPTIONAL peer of the
 * permissions module — a REST-only consumer must not have to install a GraphQL
 * library to answer questions about REST. The same argument `getRequest` makes,
 * and the reason the guard reads the transport structurally everywhere else.
 *
 * Returns `undefined` off the GraphQL path, so the guard falls through to
 * parsing the URL — which is the right answer for a REST handler, whose ids are
 * already in it.
 */
export function argsFromContext(context: unknown): Record<string, unknown> | undefined {
  const ctx = context as ExecutionContext;
  if (ctx.getType<'graphql'>() !== 'graphql') return undefined;
  return GqlExecutionContext.create(ctx).getArgs() as Record<string, unknown>;
}

/**
 * @param tokens the app's TokenService, for the WebSocket handshake.
 *
 * Passed in rather than imported so this stays a pure function of its inputs
 * and the module wires it — `AppModule` uses `useFactory` with `inject`, which
 * is also what lets a test hand it a stub verifier.
 */
export function graphqlOptions(tokens: Pick<TokenService, 'verifyWsTicket'>): ApolloDriverConfig {
  return {
    driver: ApolloDriver,
    path: `/api/v1/${GRAPHQL_PATH}`,

    // Code-first: the schema is derived from the decorated classes the
    // container holds, then written out for the frontend's codegen.
    autoSchemaFile: join(process.cwd(), 'schema.graphql'),
    // Deterministic ordering, so the checked-in schema diffs on real changes
    // rather than on whatever order Nest happened to instantiate providers in.
    sortSchema: true,

    /*
     * Introspection OFF in production.
     *
     * It is not a security boundary — every field is still enforced by its
     * guard, and an attacker can find fields by guessing. It is removed because
     * publishing a complete map of the API to anyone who asks makes that
     * guessing unnecessary, and there is no reason a production client needs it:
     * the frontend generates its types from the checked-in schema at build time.
     */
    introspection: env.NODE_ENV !== 'production',
    playground: false,

    /**
     * ONE context function, serving BOTH transports — and it has to be one,
     * because `GqlSubscriptionService` passes this very function to
     * `useServer` as the socket's context builder.
     *
     * `req` is what every resolver reads the principal off. Over HTTP,
     * `JwtAuthGuard` runs first and leaves it there. Over a WebSocket there is
     * no request and no HTTP guard, so the principal comes from the socket's
     * `extra`, where the handshake put it — see ./ws-context.ts.
     *
     * Distinguished by `extra`, which only `graphql-ws`' Context carries;
     * Apollo's HTTP argument is `{ req, res }` and has none. That check is the
     * whole branch: everything downstream sees the identical `{ req }` shape
     * and no guard, resolver or `resolvePrincipal` learns which transport it
     * is on.
     *
     * ⚠ It cannot be split into a `context` inside the `graphql-ws` block —
     * that is where this started, and Nest's `GraphQLWsSubscriptionsConfig`
     * does not declare the property, so it would need a cast that hides exactly
     * the coupling worth stating.
     */
    context: (arg: { req?: unknown; res?: unknown; extra?: unknown }) =>
      'extra' in arg ? connectionContext(arg.extra) : { req: arg.req, res: arg.res },

    /*
     * ── subscriptions ───────────────────────────────────────────────────────
     *
     * `graphql-ws` only. The older `subscriptions-transport-ws` is unmaintained
     * and Apollo Server 5 does not ship it; supporting both would mean two
     * handshakes to authenticate and two places to get that wrong.
     *
     * The path is the SAME as the HTTP endpoint. One URL, two protocols — a
     * client upgrades where it would have posted, which is what the plan means
     * by "subscriptions ride graphql-ws over one WebSocket" (§7).
     *
     * ⚠ This is why the API cannot be serverless (§5, §12.4): a Vercel function
     * cannot hold a connection open, and the failure is SILENT — the socket
     * never connects and the UI simply never updates.
     */
    subscriptions: {
      'graphql-ws': {
        /**
         * Authenticates ONCE, at connection_init, and shapes the result to look
         * like an authenticated HTTP request — see ./ws-context.ts. Everything
         * downstream (`requestFromContext`, `resolvePrincipal`, `FeatureGuard`)
         * is unchanged and unaware.
         *
         * Throwing closes the socket, which is the behaviour wanted: a
         * connection that failed to authenticate must not linger in a state
         * where a later `subscribe` might be evaluated against no principal.
         */
        onConnect: (ctx: { connectionParams?: Record<string, unknown> | undefined; extra?: unknown }) => {
          const connection = authenticateConnection(tokens, ctx.connectionParams);
          /*
           * FALSE, not a throw. `graphql-ws` closes a thrown error as 4500
           * "internal server error", which tells the client to retry — and a
           * bad ticket cannot become good. Returning false closes it as 4403,
           * the library's own "declined", which clients treat as fatal.
           */
          if (!connection) return false;

          /*
           * Stashed on `extra`, NEVER returned. An object returned from
           * `onConnect` is sent to the client as the connection_ack payload —
           * returning the connection would publish the principal to the
           * browser. See `rememberConnection`.
           */
          rememberConnection(ctx.extra, connection);

          /*
           * The socket closes when the authorization that opened it expires.
           *
           * The one property that makes subscriptions safe to add: a query is
           * authorized per request, a subscription once at subscribe time. See
           * `closeWhenAuthorizationExpires`.
           *
           * `extra` is `unknown` on the library's Context — whatever the server
           * implementation put there, which for the ws adapter is
           * `{ socket, request }`. Narrowed defensively rather than cast: an
           * adapter without a socket must lose the expiry timer, not throw
           * inside the handshake and refuse every connection.
           */
          const socket = (ctx.extra as { socket?: { close(code: number, reason: string): void } } | undefined)?.socket;
          if (socket) closeWhenAuthorizationExpires(socket, connection.expiresAt);

          // `true`, not the connection. See above.
          return true;
        },
      },
    },

    /*
     * A resolver that throws a Nest HttpException surfaces its status in
     * `extensions`, and the default formatter also attaches a stack trace
     * outside production. Stripped here for the same reason the REST layer
     * returns one message for every credential failure: the difference between
     * "no such field" and "you may not read this field" is information.
     */
    formatError: (error) => ({
      message: error.message,
      // Spread rather than assigned: `path` is absent on an error raised before
      // a field was entered, and `exactOptionalPropertyTypes` treats an explicit
      // `undefined` as a different thing from an absent key.
      ...(error.path ? { path: error.path } : {}),
      ...(env.NODE_ENV === 'production' ? {} : { extensions: error.extensions }),
    }),
  };
}
