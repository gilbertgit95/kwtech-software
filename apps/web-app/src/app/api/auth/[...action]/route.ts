/**
 * Every auth endpoint the browser may reach, served by the module.
 *
 * Next discovers route handlers from the filesystem and a package cannot inject
 * one — the same constraint that gives the module pages their catch-all
 * (PLAN §12.11). So this file is the irreducible cost of adopting the module,
 * and it is one line: the handler behind it — the credential proxy, the
 * httpOnly cookies, sign-out that revokes as well as forgets — lives in
 * `@kwtech/module-auth/next` and is reviewed once for every app.
 *
 * It reads `API_URL` and `SESSION_COOKIE` from the environment. To use
 * different names or a different source, swap this for:
 *
 *   const { POST } = createAuthRouteHandlers({ apiUrl, cookieName, secure });
 *   export { POST };
 */
export { POST } from '@kwtech/module-auth/next';
