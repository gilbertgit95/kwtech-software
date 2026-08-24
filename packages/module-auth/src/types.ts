/**
 * The vocabulary every layer shares. No framework, no node builtins — so a
 * resolver, a React page, a CLI and a test all mean the same thing by
 * "principal".
 */

/**
 * What a TOKEN is allowed to do, independent of what its holder is entitled to.
 *
 * `full` is an ordinary session. The others are step-up tokens: they prove
 * identity for exactly one endpoint and are refused everywhere else, so a
 * half-admitted user can hold a session without that session granting anything.
 *
 *   pwd_change  the password is correct but must be changed before continuing.
 *   mfa         the password is correct and a SECOND FACTOR is still owed.
 *               Reserved now, unused until 2FA is implemented — but the value
 *               has to exist before the sign-in path can represent that user at
 *               all, and adding it later would mean every already-issued token
 *               was minted by a verifier that did not know the scope existed.
 *
 * The app's `resolvePrincipal` admits `full` and nothing else, so a new scope
 * grants no permissions anywhere by default — which is the direction a
 * half-finished sign-in should fail in.
 *
 * This is deliberately NOT a permission. Permissions answer "may this person
 * do X"; scope answers "may this credential be used for X at all", and a
 * password-change token held by an administrator must still be refused
 * everywhere but /auth/change-password.
 */
export type TokenScope = 'full' | 'pwd_change' | 'mfa';

/**
 * Who the caller is, as established by a verified access token.
 *
 * Deliberately NOT the user row. A principal carries only what a guard needs to
 * decide; anything richer — name, email, roles — is a query the endpoint that
 * wants it can make. Keeping it thin is what lets the same object come out of
 * an HTTP header, a WebSocket connection-init payload and a test fixture
 * without three shapes.
 *
 * `userId` is the seam with @kwtech/module-permissions: the app's
 * `resolvePrincipal` reads it off the request and hands it over. Neither module
 * imports the other.
 */
export interface Principal {
  userId: string;
  /** The AuthSession row. Revoking it refuses the next refresh. */
  sessionId: string;
  scope: TokenScope;
  /** Access-token expiry, epoch seconds. The WebSocket layer closes on it. */
  expiresAt: number;
}

/**
 * Why an auth attempt failed — for LOGS and TESTS, never for the response.
 *
 * The whole point of the sign-in path is that the caller learns whether it
 * succeeded and nothing else. These values exist so an operator reading a log
 * can tell an unknown address from a locked account; the HTTP layer collapses
 * every one of them into the same 401 with the same message.
 */
export type AuthFailureReason =
  | 'unknown_email'
  | 'wrong_password'
  | 'account_locked'
  | 'account_suspended'
  | 'no_password_credential'
  | 'session_unknown'
  | 'session_revoked'
  | 'session_expired'
  | 'reset_token_unknown'
  | 'reset_token_expired'
  | 'reset_token_consumed'
  | 'weak_password';

/**
 * Federated sign-in providers — VOCABULARY ONLY, nothing implements these yet.
 *
 * Declared here rather than waiting because the sign-in path already has to be
 * honest about a user who has no password: someone who signed up with Google
 * holds an AuthIdentity and no AuthCredential, and `no_password_credential`
 * exists for exactly that person. The type mirrors `AuthIdentityProvider` in
 * prisma/auth.prisma.
 */
export type IdentityProvider = 'google' | 'microsoft';

/**
 * How a provider account maps to a local user. Not used yet; written down
 * because the choice is not reversible once accounts exist.
 *
 *   subject  the provider's stable `sub` claim. The ONLY safe match key.
 *   email    never a match key. Addresses change hands, and a provider that
 *            does not verify them turns "sign in with X" into a way to claim
 *            someone else's account.
 */
export interface FederatedIdentity {
  provider: IdentityProvider;
  subject: string;
  email: string | null;
  emailVerifiedByProvider: boolean;
  displayName: string | null;
}

/** The user fields a client is allowed to see about itself. */
export interface SessionUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
}

/** What a successful sign-in, refresh or reset hands back. */
export interface AuthResult {
  user: SessionUser;
  accessToken: string;
  /** ISO-8601, so the client can schedule a refresh rather than wait for a 401. */
  expiresAt: string;
  refreshToken: string;
  scope: TokenScope;
  /** True when the only thing this session may do is change the password. */
  mustChangePassword: boolean;
}
