import { join } from 'node:path';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { env } from '../config/env.js';

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

export function graphqlOptions(): ApolloDriverConfig {
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

    /*
     * `req` on the GraphQL context is what every resolver reads the principal
     * off. JwtAuthGuard runs first and leaves it there, exactly as it does for a
     * REST handler — which is the point: one authentication path, two
     * transports. See requestFromContext above.
     */
    context: ({ req, res }: { req: unknown; res: unknown }) => ({ req, res }),

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
