import type { AuthFailureReason, FederatedIdentity } from '../types.js';

/**
 * Federated sign-in, the pure half: what an ID token must say before anyone
 * believes it, and which local account a verified identity may reach.
 *
 * No HTTP and no crypto here. Fetching the token is the service's job
 * (server/google-oidc.ts); this file decides what to DO with it. That split is
 * what lets every refusal below be tested with a literal object.
 */

/** The issuers Google signs with. It uses both spellings, and both are genuine. */
export const GOOGLE_ISSUERS: readonly string[] = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Seconds of clock skew forgiven on `exp` and `iat`. A server a few seconds
 * behind Google must not refuse a token Google issued a moment ago.
 */
export const ID_TOKEN_CLOCK_SKEW = 60;

/** Why an ID token was not believed. For logs only, like every AuthFailureReason. */
export type IdTokenRefusal = Extract<AuthFailureReason, 'federated_token_invalid'>;

/**
 * The payload of a compact JWS, decoded WITHOUT checking its signature.
 *
 * ⚠ Only safe for a token this server received DIRECTLY from the issuer's token
 * endpoint over TLS, which is the one place this module reads one. OpenID
 * Connect Core §3.1.3.7 allows exactly that: the TLS connection authenticates
 * the issuer, so the signature adds nothing. An ID token that arrived any other
 * way — from the browser, in a URL — must be signature-checked, and this
 * function must not be used on it.
 *
 * Returns null for anything that is not three base64url segments with a JSON
 * object in the middle.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Checks a Google ID token's claims and turns them into a FederatedIdentity.
 *
 * Every check here is one an attacker would otherwise get to skip:
 *
 *   iss    the token came from Google, not from another issuer that happens to
 *          use the same claim names.
 *   aud    it was issued to THIS client. Without it, a token Google issued to
 *          any other site the victim signed in to would sign them in here.
 *   exp    it is still current.
 *   nonce  it answers THIS sign-in, started in this browser. Without it, a
 *          token captured from one attempt could complete another.
 *   sub    present. It is the match key, and nothing else may stand in for it.
 *
 * `email_verified` is carried, not required: an unverified address may still
 * sign in to an identity that is already linked, because that match is by
 * `sub`. It only stops LINKING — see planFederatedSignIn.
 */
export function prepareGoogleIdentity(
  claims: Record<string, unknown>,
  expected: { clientId: string; nonce: string; now: Date },
): { identity: FederatedIdentity } | { refused: IdTokenRefusal } {
  const nowSeconds = Math.floor(expected.now.getTime() / 1000);

  if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.includes(claims.iss)) {
    return { refused: 'federated_token_invalid' };
  }
  // `aud` may be a string or an array per the spec; Google sends a string, and
  // an array must still contain us.
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expected.clientId)) return { refused: 'federated_token_invalid' };
  if (typeof claims.exp !== 'number' || claims.exp + ID_TOKEN_CLOCK_SKEW < nowSeconds) {
    return { refused: 'federated_token_invalid' };
  }
  if (typeof claims.iat === 'number' && claims.iat - ID_TOKEN_CLOCK_SKEW > nowSeconds) {
    return { refused: 'federated_token_invalid' };
  }
  // Compared as strings, and required to be non-empty on both sides: an empty
  // expected nonce matching an absent claim would be no check at all.
  if (!expected.nonce || claims.nonce !== expected.nonce) return { refused: 'federated_token_invalid' };
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) return { refused: 'federated_token_invalid' };

  return {
    identity: {
      provider: 'google',
      subject: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : null,
      // `true`, or the string "true" that older Google tokens carried. Anything
      // else — absent, false, "yes" — is unverified, which is the direction to
      // fail in.
      emailVerifiedByProvider: claims.email_verified === true || claims.email_verified === 'true',
      displayName: typeof claims.name === 'string' && claims.name.trim().length > 0 ? claims.name.trim() : null,
    },
  };
}

/**
 * Where a verified identity may go.
 *
 *   sign_in  it is already linked to a user. Match by `sub`, nothing else.
 *   link     not linked, but a local account has the same address AND the
 *            provider has verified it. Attach it, then sign in.
 *   refuse   anything else.
 *
 * There is NO "create" outcome. Accounts here come into being through an
 * invitation (PLAN §13, 2026-09-25), and a Google button that quietly made
 * accounts would be public sign-up by the back door.
 */
export type FederatedSignInPlan =
  | { kind: 'sign_in'; userId: string }
  | { kind: 'link'; userId: string }
  | {
      kind: 'refuse';
      reason: Extract<
        AuthFailureReason,
        'federated_no_account' | 'federated_email_unverified' | 'federated_already_linked'
      >;
    };

export function planFederatedSignIn(input: {
  /** The user this provider account is already linked to, if any. */
  linkedUserId: string | null;
  /** The local account with the identity's address, if any. */
  userWithEmail: { id: string } | null;
  /** Whether that account already holds an identity from this provider — a DIFFERENT one. */
  userHasProviderIdentity: boolean;
  identity: Pick<FederatedIdentity, 'emailVerifiedByProvider'>;
}): FederatedSignInPlan {
  if (input.linkedUserId !== null) return { kind: 'sign_in', userId: input.linkedUserId };
  if (!input.userWithEmail) return { kind: 'refuse', reason: 'federated_no_account' };
  // THE check that keeps email from becoming a match key by the back door. An
  // address the provider has not verified is a claim anyone can make.
  if (!input.identity.emailVerifiedByProvider) return { kind: 'refuse', reason: 'federated_email_unverified' };
  // The account is linked to a different Google account already. Linking a
  // second would break @@unique([userId, provider]), and silently replacing the
  // first would hand the account to whoever holds the new one.
  if (input.userHasProviderIdentity) return { kind: 'refuse', reason: 'federated_already_linked' };
  return { kind: 'link', userId: input.userWithEmail.id };
}
