import { Inject, UnauthorizedException } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ACCESS_TOKEN_TTL } from '../../domain/policy.js';
import type { Principal } from '../../types.js';
import { PRINCIPAL_KEY } from '../auth.decorators.js';
import { AUTH_OPTIONS, type ResolvedAuthModuleOptions } from '../auth.options.js';
import { AuthService } from '../auth.service.js';
import { AuthDisplayService } from '../auth-display.service.js';
import { UpdateDisplayInput, UpdateProfileInput } from './auth.inputs.js';
import { DisplayPreferencesType, MfaFactorType, SessionInfoType, ViewerType } from './auth.types.js';

/**
 * The module's read side, on the graph.
 *
 * `AuthModule.forRoot()` lists this as a provider whenever `expose.graphql` is
 * on, so an app that mounts the module and a GraphQLModule has these queries
 * with no further wiring — code-first means nothing is stitched.
 *
 * ## What is deliberately NOT here
 *
 * Every credential exchange — signin, verify-mfa, refresh, signout, and the two
 * password-reset endpoints — stays on the REST controller, and moving it here
 * would be a regression rather than a migration:
 *
 *   - **Aliasing defeats the rate limit.** One GraphQL operation may repeat a
 *     field under different aliases, so `mutation { a: signIn(…) b: signIn(…) … }`
 *     is fifty password attempts in a single HTTP request that the per-IP
 *     throttler counts once. Field aliasing is core to the language; unlike
 *     batching it cannot be switched off.
 *   - **The tight throttler bucket is path-based.** It selects the credential
 *     limit by matching the resolved handler against AuthController. Under
 *     GraphQL there is one POST for everything, so the only thing left to
 *     throttle on is the operation name — text the caller chooses.
 *   - **Cookies and redirects.** The Next adapter turns a JSON body into an
 *     httpOnly cookie, and sign-out answers 303. GraphQL has one response shape
 *     and no redirect.
 *
 * So the boundary is: credential exchange over REST, reads over the graph.
 */
@Resolver()
export class AuthResolver {
  constructor(
    private readonly auth: AuthService,
    private readonly display: AuthDisplayService,
    @Inject(AUTH_OPTIONS) private readonly options: ResolvedAuthModuleOptions,
  ) {}

  /**
   * The signed-in user's own record — a DATABASE READ.
   *
   * **Nullable, and null means "not signed in"** rather than an error, matching
   * `myPermissions` in @kwtech/module-permissions. This is the query a shell
   * calls on load to decide what to render; a signed-out visitor asking it is an
   * ordinary state, and throwing would make every layout a try/catch.
   *
   * Null also covers an account suspended or deleted since the token was issued.
   * The token stays cryptographically valid until it expires — verification
   * reads no database, by design — so this query is the check that notices.
   */
  @Query(() => ViewerType, { name: 'viewer', nullable: true })
  async viewer(@Context() gqlContext: { req?: Record<string, unknown> }): Promise<ViewerType | null> {
    const principal = principalOf(gqlContext);
    if (!principal) return null;

    const user = await this.auth.profile(principal);
    return user ? { id: user.id, email: user.email, username: user.username, displayName: user.displayName } : null;
  }

  /**
   * What the token itself says. No database read.
   *
   * The GraphQL equivalent of /auth/me, and worth keeping separate from `viewer`
   * for the same reason the two endpoints are separate: a client that only needs
   * to know whether it still holds a `full` scope should not pay for a user
   * lookup. Asking for both in one operation still costs one round trip.
   */
  @Query(() => SessionInfoType, { name: 'session', nullable: true })
  session(@Context() gqlContext: { req?: Record<string, unknown> }): SessionInfoType | null {
    const principal = principalOf(gqlContext);
    if (!principal) return null;
    return {
      userId: principal.userId,
      scope: principal.scope,
      expiresAt: principal.expiresAt,
      accessTokenTtl: this.options.accessTokenTtl ?? ACCESS_TOKEN_TTL,
    };
  }

  /**
   * What the caller has enrolled. A read, so it lives on the graph — unlike
   * enrolment and removal, which take the current password and stay on REST.
   *
   * Returns an empty list rather than null for a signed-out caller: "you have no
   * factors" and "we do not know who you are" render the same way on a settings
   * page nobody unauthenticated can reach anyway, and an empty array spares
   * every caller a null check.
   */
  @Query(() => [MfaFactorType], { name: 'mfaFactors' })
  async mfaFactors(@Context() gqlContext: { req?: Record<string, unknown> }): Promise<MfaFactorType[]> {
    const principal = principalOf(gqlContext);
    if (!principal) return [];
    return this.auth.listMfaFactors(principal);
  }

  /**
   * Renames the caller's own account.
   *
   * On the GRAPH rather than on the controller, unlike change-password: this
   * carries no secret, so there is nothing for field aliasing to brute-force.
   * The split is the whole boundary — credential exchange over REST, everything
   * else over the graph.
   *
   * Returns the updated viewer, so a form can render the new state without a
   * second round trip.
   */
  @Mutation(() => ViewerType, { name: 'updateProfile' })
  async updateProfile(
    @Context() gqlContext: { req?: Record<string, unknown> },
    @Args('input') input: UpdateProfileInput,
  ): Promise<ViewerType> {
    const principal = principalOf(gqlContext);
    // The guard has already refused an unauthenticated caller; this is the
    // narrowing, not the check.
    if (!principal) throw new UnauthorizedException('Not signed in');

    const user = await this.auth.updateProfile(principal, {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.username !== undefined ? { username: input.username } : {}),
    });
    return { id: user.id, email: user.email, username: user.username, displayName: user.displayName };
  }

  /**
   * The caller's display sizes (issue #20), or null when nobody is signed in.
   * The app shell asks for it with `viewer` on every page, so the sizes apply
   * before the page paints. Defaults when they never chose — never null for a
   * signed-in caller, so "not signed in" and "never chose" stay apart.
   *
   * Session only, no feature key: see AuthDisplayService for why.
   *
   * `layout` picks the full site's sizes (`desktop`, the default) or the phone
   * layout's (`mobile`) — kept apart since issue #22. The shell asks for the
   * one it is drawing.
   */
  @Query(() => DisplayPreferencesType, { name: 'myDisplay', nullable: true })
  async myDisplay(
    @Context() gqlContext: { req?: Record<string, unknown> },
    @Args('layout', { type: () => String, nullable: true }) layout: string | null,
  ): Promise<DisplayPreferencesType | null> {
    const principal = principalOf(gqlContext);
    if (!principal) return null;
    return this.display.read(principal.userId, this.display.layoutOf(layout));
  }

  /** Changes the caller's own display sizes, and returns them as saved. */
  @Mutation(() => DisplayPreferencesType, { name: 'updateMyDisplay' })
  async updateMyDisplay(
    @Context() gqlContext: { req?: Record<string, unknown> },
    @Args('input') input: UpdateDisplayInput,
  ): Promise<DisplayPreferencesType> {
    const principal = principalOf(gqlContext);
    // The guard has already refused an unauthenticated caller; this is the narrowing.
    if (!principal) throw new UnauthorizedException('Not signed in');
    return this.display.update(principal.userId, this.display.layoutOf(input.layout), {
      ...(input.textSize != null ? { textSize: input.textSize } : {}),
      ...(input.spacing != null ? { spacing: input.spacing } : {}),
    });
  }
}

/**
 * The principal JwtAuthGuard left on the request.
 *
 * Read off the request rather than taken from a param decorator, because the
 * request is the one object every transport agrees on — the guard stashes it
 * there for REST, GraphQL and, once subscriptions land, the socket. See
 * AuthModuleOptions.getRequest for how the guard finds it in the first place.
 */
function principalOf(gqlContext: { req?: Record<string, unknown> }): Principal | null {
  return (gqlContext.req?.[PRINCIPAL_KEY] as Principal | undefined) ?? null;
}
