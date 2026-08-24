import type { Principal } from '@kwtech/module-auth';
import { PRINCIPAL_KEY } from '@kwtech/module-auth/server';

/**
 * THE SEAM. The only place authentication and authorisation touch.
 *
 * `@kwtech/module-auth` and `@kwtech/module-permissions` do not import each
 * other and know nothing of each other. Auth verifies a token and leaves a
 * Principal on the request; this reads the `userId` off it and hands it to
 * permissions, which holds that id as a bare string with no foreign key.
 *
 * Extracted from AppModule rather than left inline because it is the highest-
 * consequence function in the app and an inline arrow in a decorator cannot be
 * tested. Everything it decides is a security decision.
 */
export function resolvePrincipal(request: unknown): { userId: string } | undefined {
  const principal = (request as Record<string, unknown> | undefined)?.[PRINCIPAL_KEY] as Principal | undefined;

  // No token, or one the guard refused. Permissions answers nothing for nobody.
  if (!principal) return undefined;

  // An empty id is not a caller. It would reach the permission tables, match no
  // membership and be denied — so the outcome is the same either way, but only
  // one of the two is an answer to a question that was asked.
  if (typeof principal.userId !== 'string' || principal.userId.length === 0) return undefined;

  /**
   * A step-up token is not a session.
   *
   * Someone who must change their password holds a credential that proves
   * identity for exactly one endpoint. If it resolved to a permission context,
   * every OTHER endpoint would authorise them normally — which would make the
   * whole point of a restricted scope decorative. Refusing here means the token
   * grants nothing anywhere, including in a module that has never heard of
   * scopes.
   */
  if (principal.scope !== 'full') return undefined;

  /**
   * Only the id crosses. Not the session, not the scope, not the expiry:
   * permissions answers "what may this user do", and anything else handed over
   * would be a second copy of a fact auth already owns.
   *
   * The organization and workspace are deliberately absent too — they come from
   * the URL, parsed by the permissions module's own scope.ts. Reading them from
   * the token would bake the active tenant into a week-long credential, so
   * switching organization would need a new sign-in.
   */
  return { userId: principal.userId };
}
