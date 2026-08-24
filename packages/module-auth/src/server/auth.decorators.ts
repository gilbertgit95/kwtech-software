import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Principal, TokenScope } from '../types.js';

export const IS_PUBLIC = 'kwtech:auth-public';
export const ALLOWED_SCOPES = 'kwtech:auth-scopes';

/** Where the guard stashes the verified principal. */
export const PRINCIPAL_KEY = 'kwtechPrincipal';

/**
 * Opts a handler out of authentication.
 *
 * Note the difference from @kwtech/module-permissions, where enforcement is
 * OPT-IN. Authentication is opt-OUT: the credential endpoints are the only
 * places a caller can have no token yet, and defaulting the other way would
 * make every unannotated handler anonymous. The reason string is required so
 * the exception is a decision on the record rather than a habit.
 */
export const Public = (reason: string) => SetMetadata(IS_PUBLIC, reason);

/**
 * Restricts a handler to particular token scopes.
 *
 * Without it a handler accepts `full` only. That default is what makes a
 * step-up token safe to issue: a `pwd_change` token is refused everywhere
 * except the one endpoint that names it.
 */
export const AllowScopes = (...scopes: TokenScope[]) => SetMetadata(ALLOWED_SCOPES, scopes);

/** The verified principal, for handlers that want it without reading the request. */
export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Record<string, unknown>>();
  return request[PRINCIPAL_KEY] as Principal | undefined;
});
