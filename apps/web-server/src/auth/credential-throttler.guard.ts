import { AuthController, CREDENTIAL_ENDPOINTS } from '@kwtech/module-auth/server';
import { type ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';

/**
 * Points the tight `credential` bucket at the endpoints where somebody is
 * GUESSING a secret, and leaves every other route on the ordinary one.
 *
 * ## Why this class exists
 *
 * `ThrottlerModule.forRoot` here declares two buckets — `default` (120/min) and
 * `credential` (10/min) — and the documented way to opt a route into the second
 * is `@Throttle({ credential: {} })` on the handler. Those handlers live in
 * `@kwtech/module-auth`, which cannot carry that decorator: it would make
 * @nestjs/throttler a dependency of every consumer of the package, including
 * ones that never mount an HTTP server. So the module publishes the LIST
 * (`CREDENTIAL_ENDPOINTS`) and the app applies the policy — which is the same
 * division of labour as `sendPasswordResetEmail`.
 *
 * ## Why it is not a URL match
 *
 * Matching on `/auth/signin` would be a second list, in a second place, that
 * silently stops covering an endpoint the day the module adds one — and it
 * would have to know about the `/api/v1` prefix. Comparing the resolved handler
 * against the controller the module exports cannot drift: if the method is
 * renamed, the reference is renamed with it.
 *
 * ## What it does NOT protect against
 *
 * A per-IP limit alone lets a botnet spread guesses across many accounts. The
 * other half is the per-account lockout inside AuthService. Neither is
 * sufficient; both together are.
 */
@Injectable()
export class CredentialThrottlerGuard extends ThrottlerGuard {
  /**
   * WebSocket operations are not throttled here, and that is a decision rather
   * than an oversight.
   *
   * `ThrottlerGuard` writes `X-RateLimit-*` onto the RESPONSE. A subscription
   * has none — the GraphQL context for a socket carries `req` alone — so the
   * base class reads `.header` off undefined and every subscription fails with
   * an INTERNAL_SERVER_ERROR naming the throttler. That is the symptom; the
   * reason to skip rather than to stub a response is that per-request IP
   * limiting answers a question a socket does not ask. One connection is one
   * HTTP upgrade, already counted by the `default` bucket.
   *
   * ⚠ What is therefore NOT covered: a client that opens one socket and floods
   * `subscribe` messages down it. Three things bound that today — the handshake
   * needs a ticket, a ticket needs a live session, and the socket closes when
   * the access token expires — but none of them is a rate limit. If subscription
   * volume ever needs bounding, it belongs in `graphql-ws`' own hooks
   * (`onSubscribe`), not here, because that is the layer that can see the
   * connection rather than the request.
   */
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType<'graphql'>() === 'graphql') {
      // No `res` means a socket. See above.
      if (!GqlExecutionContext.create(context).getContext().res) return true;
    }
    return super.shouldSkip(context);
  }

  /**
   * Where the request and response live, on either transport.
   *
   * The third guard in this app to need this — after JwtAuthGuard and
   * FeatureGuard, both of which take it as a configured hook. ThrottlerGuard is
   * a third-party class, so the seam is an override instead: its default reads
   * `switchToHttp()`, which is an empty shell for a GraphQL resolver, and the
   * tracker then reads `.ip` off undefined and every GraphQL field fails with an
   * INTERNAL_SERVER_ERROR naming the throttler but not the transport.
   *
   * The GraphQL context carries `{ req, res }` because
   * ../graphql/graphql.options.ts puts them there — so per-IP limiting covers
   * GraphQL exactly as it covers REST, rather than being silently skipped on the
   * transport this app is moving its reads to.
   */
  protected override getRequestResponse(context: ExecutionContext): {
    req: Record<string, unknown>;
    res: Record<string, unknown>;
  } {
    if (context.getType<'graphql'>() === 'graphql') {
      const gql = GqlExecutionContext.create(context).getContext();
      return { req: gql.req, res: gql.res };
    }
    return super.getRequestResponse(context) as { req: Record<string, unknown>; res: Record<string, unknown> };
  }

  protected override async handleRequest(request: ThrottlerRequest): Promise<boolean> {
    // The `default` bucket applies everywhere, exactly as it did before.
    if (request.throttler.name !== 'credential') return super.handleRequest(request);

    // The `credential` bucket applies only to the guessing endpoints. Returning
    // true skips this bucket for the request without consuming from it.
    return isCredentialEndpoint(request.context) ? super.handleRequest(request) : true;
  }
}

function isCredentialEndpoint(context: ExecutionContext): boolean {
  if (context.getType() !== 'http') return false;
  if (context.getClass() !== AuthController) return false;

  const name = context.getHandler().name as (typeof CREDENTIAL_ENDPOINTS)[number];
  return CREDENTIAL_ENDPOINTS.includes(name);
}
