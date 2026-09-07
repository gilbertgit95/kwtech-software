import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Principal, TokenScope } from '../types.js';
import { ALLOWED_SCOPES, IS_PUBLIC, PRINCIPAL_KEY } from './auth.decorators.js';
// Imported straight from auth.options.js, and no leaf-token file is needed:
// nothing in that file imports a provider, so there is no cycle for the token to
// be caught in. Contrast @kwtech/module-permissions, whose options module DOES
// import its resolver — see its permissions.tokens.ts.
import { AUTH_OPTIONS, type ResolvedAuthModuleOptions } from './auth.options.js';
import { SESSION_REVOCATION_STORE, type SessionRevocationStore } from './revocation.js';
import { TokenService } from './token.service.js';

/**
 * Turns a bearer token into a principal, or refuses.
 *
 * Apply it GLOBALLY. Authentication is opt-out (see @Public) precisely so that
 * forgetting to annotate a handler leaves it protected rather than open — the
 * opposite default from the permissions guard, and for the opposite reason:
 * there, most surfaces genuinely are unguarded; here, almost none are.
 *
 * Stateless. It verifies a signature and reads claims; it does not ask whether
 * the session is still alive, because that would be a database round trip on
 * every request. Revocation takes effect at the next refresh, and the access
 * token's TTL is the window — see AuthSession in prisma/auth.prisma.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(AUTH_OPTIONS) private readonly options: ResolvedAuthModuleOptions,
    @Optional()
    @Inject(SESSION_REVOCATION_STORE)
    private readonly revoked?: SessionRevocationStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<string | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    /*
     * The request, on WHATEVER transport this is.
     *
     * `switchToHttp()` returns an empty shell for a GraphQL resolver, so a guard
     * that assumed HTTP would read `.headers` off undefined and fail the field
     * with an error that names neither the transport nor the cause. The app
     * supplies the mapping (see AuthModuleOptions.getRequest); plain HTTP needs
     * no configuration and keeps the old behaviour.
     */
    const request = (this.options.getRequest?.(context) ?? context.switchToHttp().getRequest()) as Record<
      string,
      unknown
    >;
    /*
     * A principal the TRANSPORT already established, or a bearer token.
     *
     * The first case is the WebSocket. A socket has one upgrade request and
     * then frames — there is no per-operation header to read — so it
     * authenticates at the handshake and hands every operation a request-shaped
     * object carrying the result. Without this branch the guard reads no header,
     * finds no token and refuses every subscription with "Not signed in", which
     * is exactly what it did until this was written.
     *
     * ⚠ It is not a bypass, and the two things that make it safe are worth
     * stating because they are easy to remove by accident:
     *
     *   1. Nothing outside the process can set this. `request` here is Express's
     *      own object on HTTP, and a header, query parameter or body field
     *      cannot become a property on it — `PRINCIPAL_KEY` is only ever
     *      assigned by this guard, or by a transport adapter inside the app that
     *      verified a credential first.
     *   2. Every check below still runs on it. The scope rule and the revocation
     *      lookup do not care where the principal came from, so a socket opened
     *      by a session that was later signed out is refused on its next
     *      operation exactly as an HTTP call would be.
     *
     * What it deliberately does NOT do is re-verify a signature. There is no
     * token here to verify — the ticket was consumed at the handshake, and
     * re-checking would mean keeping a credential alive for the life of the
     * connection, which is the thing the ticket design avoids.
     */
    const established = request[PRINCIPAL_KEY] as Principal | undefined;
    const header = (request.headers as Record<string, unknown> | undefined)?.authorization;
    const principal = established ?? this.tokens.verifyAccess(TokenService.bearer(header));

    // 401, not 403: the caller has not proved who they are. A frontend reads
    // the first as "sign in" and the second as "stop asking".
    if (!principal) throw new UnauthorizedException('Not signed in');

    const allowed = this.reflector.getAllAndOverride<TokenScope[] | undefined>(ALLOWED_SCOPES, [
      context.getHandler(),
      context.getClass(),
    ]) ?? ['full'];

    // A step-up token proves identity for one endpoint. Presenting it anywhere
    // else is authenticated but not permitted — 403, and the message says which
    // scope was needed so the frontend can route the user to the right page.
    if (!allowed.includes(principal.scope)) {
      throw new ForbiddenException({
        message: `This endpoint requires a ${allowed.join(' or ')} session`,
        reason: 'wrong_token_scope',
        scope: principal.scope,
      });
    }

    /*
     * THE REVOCATION CHECK, and it is what makes sign-out immediate.
     *
     * The signature says the token is genuine; this says whether it is still
     * worth anything. Without it, revocation waits for the next refresh and a
     * stolen token keeps working for the rest of its life — the window that
     * lowering AUTH_ACCESS_TOKEN_TTL only ever bounded.
     *
     * An O(1) lookup against a store that holds only the last few minutes of
     * revocations, NOT a database read: the point is to close the window without
     * giving back the property that keeps auth off the hot path.
     */
    if (await this.revoked?.isRevoked(principal)) {
      throw new UnauthorizedException('Not signed in');
    }

    // Stashed on the REQUEST, which is the object both guards and every
    // resolver reach through their own transport — not on the HTTP context.
    request[PRINCIPAL_KEY] = principal;
    return true;
  }
}
