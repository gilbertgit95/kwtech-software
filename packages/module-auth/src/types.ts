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
 *   mfa         the password is correct and a SECOND FACTOR is still owed. The
 *               holder may reach POST /auth/verify-mfa and nothing else — not
 *               even /auth/refresh will upgrade them, because refresh derives
 *               the scope from the session row rather than carrying the old one
 *               forward.
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
  /**
   * When the token was MINTED, epoch seconds.
   *
   * Carried for revocation: "sign out everywhere" records an instant and refuses
   * every token issued at or before it, which is one entry however many sessions
   * existed — and it keeps covering tokens that were in flight at the moment it
   * happened. Comparing against `expiresAt` instead would be wrong, because two
   * tokens minted seconds apart can share an expiry and the newer one, from a
   * legitimate sign-in AFTER the revocation, must survive.
   */
  issuedAt: number;
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
  | 'weak_password'
  | 'mfa_no_factor'
  | 'mfa_code_invalid'
  /** A code that was already spent. See AuthMfaFactor.lastUsedStep. */
  | 'mfa_code_replayed'
  | 'mfa_already_satisfied'
  | 'recovery_code_unknown'
  | 'recovery_code_used'
  /** Google sign-in was asked for and no client is configured. */
  | 'federated_not_configured'
  /** The provider refused the authorization code, or could not be reached. */
  | 'federated_exchange_failed'
  /** The ID token failed a claim check: issuer, audience, expiry, nonce, subject. */
  | 'federated_token_invalid'
  /** A genuine Google account, and no local account for it. There is no sign-up. */
  | 'federated_no_account'
  /** A local account has the address, but Google has not verified it — no linking. */
  | 'federated_email_unverified'
  /** The account is already linked to a DIFFERENT Google account. */
  | 'federated_already_linked'
  /** An emailed code was asked for too soon after the last one. */
  | 'mfa_email_resend_too_soon';

/**
 * Federated sign-in providers. `google` is implemented; `microsoft` is
 * vocabulary only. The type mirrors `AuthIdentityProvider` in
 * prisma/auth.prisma.
 */
export type IdentityProvider = 'google' | 'microsoft';

/**
 * How a provider account maps to a local user. Written down before it was used
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

/**
 * The signed-in user as a page sees it — the same fields as `SessionUser`,
 * named for the reading side. An alias rather than a second interface, so the
 * shape the API returns and the shape a page renders cannot drift apart.
 */
export type Viewer = SessionUser;

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
  /**
   * True when the password was right and a second factor is still owed.
   *
   * Derived from `scope`, not a second source of truth — but stated as its own
   * field because it is the one thing on this object a SIGN-IN PAGE needs, and
   * a page should not have to know which scope strings mean "not done yet".
   */
  mfaRequired: boolean;
}

// ─── second factors ─────────────────────────────────────────────────────────

/** What a user has enrolled, as anything outside the module may see it. */
export interface MfaFactorSummary {
  id: string;
  /** Mirrors the column. `totp` and `email` can be enrolled and verified; `webauthn` cannot. */
  type: 'totp' | 'webauthn' | 'email';
  /** The user's own name for it — "iPhone", "1Password". */
  label: string;
  /** Null until proved once; an unconfirmed factor grants and blocks nothing. */
  confirmedAt: string | null;
  lastUsedAt: string | null;
}

/**
 * A factor mid-enrolment. **Returned exactly once and never again** — the
 * secret is encrypted the moment it is stored, so there is no endpoint that can
 * show it a second time. A user who closes this page enrols again.
 */
export interface MfaEnrolment {
  factorId: string;
  /** Base32, for someone typing it in by hand. */
  secret: string;
  /**
   * `otpauth://totp/...` — what the QR code encodes.
   *
   * The module returns the URI, not an image: rendering a QR is a presentation
   * choice, and a package that picked a rendering library would decide it for
   * every consumer.
   */
  uri: string;
}

/**
 * The one-time codes that are the way back in when the factor is lost.
 *
 * Shown once, on confirmation. They are stored hashed, so "show them again" is
 * not an endpoint that can exist — the only way to see a set is to generate a
 * new one, which invalidates the old.
 */
export interface MfaRecoveryCodes {
  codes: string[];
}

/**
 * An email factor mid-enrolment. A code has been sent to the account's address,
 * and `confirmMfa` with that code and this factor id turns it on.
 *
 * Carries no secret, unlike `MfaEnrolment`: the proof is in the mailbox.
 */
export interface MfaEmailEnrolment {
  factorId: string;
  /** Where the code went — the account's own address, shown so the user knows where to look. */
  sentTo: string;
  /** ISO-8601. The code is refused after this. */
  expiresAt: string;
}

/**
 * The answer to "email me a code" at the sign-in challenge.
 *
 * `sent: false` means this account has no email factor, and the caller has to
 * use its authenticator or a recovery code. Saying so is safe here: the caller
 * already proved the password to reach the challenge at all.
 */
export interface MfaEmailCodeSent {
  sent: boolean;
  /** ISO-8601, when `sent`. */
  expiresAt: string | null;
}

/** Which sign-in methods beyond a password this deployment offers. Drives the buttons. */
export interface SignInProviders {
  google: boolean;
}

/**
 * Starting a Google sign-in: where to send the browser, and the three values
 * the browser's round trip must bring back.
 *
 * Read by a SERVER — the Next route handler — and kept there in an httpOnly
 * cookie. None of it reaches page JavaScript:
 *
 *   state         ties the callback to this browser (CSRF on the redirect).
 *   nonce         ties the ID token to this attempt (replay).
 *   codeVerifier  PKCE: a stolen authorization code is useless without it.
 */
export interface GoogleSignInStart {
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}
