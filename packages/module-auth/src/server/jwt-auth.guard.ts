import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TokenScope } from '../types.js';
import { ALLOWED_SCOPES, IS_PUBLIC, PRINCIPAL_KEY } from './auth.decorators.js';
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
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<string | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const header = (request.headers as Record<string, unknown> | undefined)?.authorization;
    const principal = this.tokens.verifyAccess(TokenService.bearer(header));

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

    request[PRINCIPAL_KEY] = principal;
    return true;
  }
}
