'use client';

import type { MfaEnrolment, MfaFactorSummary, MfaRecoveryCodes, Viewer } from '../types.js';

/**
 * What a credential call gives back to a PAGE.
 *
 * Deliberately not `AuthResult`. The route handler puts the tokens in httpOnly
 * cookies and returns none of them, so a client typed as returning `AuthResult`
 * was describing a response that never arrives — every field but this one is
 * absent at runtime.
 *
 * `mfaRequired` is the single piece of the API's answer that crosses back into
 * JavaScript, because the page cannot route the user without it.
 */
export interface AuthActionResult {
  ok: true;
  /** True when the password was right and a second factor is still owed. */
  mfaRequired?: boolean;
}

/**
 * How the pages talk to the API.
 *
 * An interface rather than a fetch call, for the reason PLAN §9 rule 6 gives:
 * apps configure, modules do not guess. Where the API lives, whether the call
 * goes to a Next route handler or straight to the server, and what happens to
 * the returned tokens are all app decisions — and the token handling in
 * particular must be, because the safe answer (an httpOnly cookie set by a
 * server route) is one a component in a package cannot implement.
 */
export interface AuthClient {
  signIn(input: { identifier: string; password: string }): Promise<AuthActionResult>;
  /**
   * Completes a sign-in that owes a second factor.
   *
   * Takes no user id and no token: the half-admitted session is in the httpOnly
   * cookie the sign-in step set, and the route handler attaches it. There is
   * nothing here for a page to hold, which is the point.
   */
  verifyMfa(input: { code: string }): Promise<AuthActionResult>;
  requestPasswordReset(input: { email: string }): Promise<void>;
  resetPassword(input: { token: string; password: string }): Promise<void>;

  // ── the settings surface ────────────────────────────────────────────────
  //
  // Everything below needs a session, which the route handler attaches from the
  // httpOnly cookie. None of it takes or returns a token, so there is nothing
  // here for a page to hold.

  /**
   * Any GraphQL operation, through the app's own origin.
   *
   * The browser cannot reach the API directly — it is a different host and the
   * session cookie is scoped to this one — so every query goes through the route
   * handler, which attaches the bearer token. Returns `data` and throws on
   * `errors`, so a caller writes one happy path.
   */
  graphql<T>(document: string, variables?: Record<string, unknown>): Promise<T>;

  /** Display name and username. Carries no secret, so it is a GraphQL mutation. */
  updateProfile(input: { displayName?: string | null; username?: string }): Promise<Viewer>;

  /** REST, not a mutation: it takes the CURRENT password, so it is guessable. */
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;

  /** Revokes every session INCLUDING this one — the caller must sign back in. */
  signOutEverywhere(): Promise<{ revoked: number }>;

  listMfaFactors(): Promise<MfaFactorSummary[]>;
  enrolMfa(input: { password: string; label: string }): Promise<MfaEnrolment>;
  confirmMfa(input: { factorId: string; code: string }): Promise<MfaRecoveryCodes>;
  removeMfaFactor(input: { factorId: string; password: string }): Promise<{ removed: boolean }>;
  regenerateRecoveryCodes(input: { password: string }): Promise<MfaRecoveryCodes>;
}

/**
 * The default: POST JSON at a base path, same-origin.
 *
 * Same-origin on purpose. The obvious alternative — point it at the API host —
 * would mean the browser holds the tokens, which is the arrangement every XSS
 * turns into a full account takeover. Pointing it at the Next app's own route
 * handlers lets that handler set an httpOnly cookie the page's JavaScript
 * cannot read. See apps/web-app/src/app/api/auth.
 */
export function createAuthClient(basePath = '/api/auth'): AuthClient {
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${basePath}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });

    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      throw new AuthClientError(problem?.message ?? 'Something went wrong. Please try again.', response.status);
    }
    return response.json().catch(() => ({}));
  };

  /**
   * One GraphQL round trip, with `errors` turned into a thrown Error.
   *
   * GraphQL answers 200 even when a field failed, so a caller checking
   * `response.ok` alone would treat a refusal as a success and render `undefined`
   * — which is how a permissions failure becomes a blank screen instead of a
   * message.
   */
  const graphql = async <T>(document: string, variables?: Record<string, unknown>): Promise<T> => {
    const body = (await post('/graphql', { query: document, variables })) as {
      data?: T;
      errors?: { message: string }[];
    };
    if (body.errors?.length) throw new AuthClientError(body.errors[0]?.message ?? 'Request failed', 400);
    if (!body.data) throw new AuthClientError('The server returned no data.', 500);
    return body.data;
  };

  return {
    signIn: (input) => post('/signin', input) as Promise<AuthActionResult>,
    verifyMfa: (input) => post('/verify-mfa', input) as Promise<AuthActionResult>,
    graphql,

    updateProfile: async (input) => {
      const data = await graphql<{ updateProfile: Viewer }>(
        `mutation UpdateProfile($input: UpdateProfileInput!) {
           updateProfile(input: $input) { id email username displayName }
         }`,
        { input },
      );
      return data.updateProfile;
    },

    listMfaFactors: async () => {
      const data = await graphql<{ mfaFactors: MfaFactorSummary[] }>(
        `query MfaFactors { mfaFactors { id type label confirmedAt lastUsedAt } }`,
      );
      return data.mfaFactors;
    },

    changePassword: async (input) => {
      await post('/change-password', input);
    },
    signOutEverywhere: () => post('/signout-all', {}) as Promise<{ revoked: number }>,
    enrolMfa: (input) => post('/mfa-enrol', input) as Promise<MfaEnrolment>,
    confirmMfa: (input) => post('/mfa-confirm', input) as Promise<MfaRecoveryCodes>,
    removeMfaFactor: (input) => post('/mfa-remove', input) as Promise<{ removed: boolean }>,
    regenerateRecoveryCodes: (input) => post('/mfa-recovery-codes', input) as Promise<MfaRecoveryCodes>,
    requestPasswordReset: async (input) => {
      await post('/forgot-password', input);
    },
    resetPassword: async (input) => {
      await post('/reset-password', input);
    },
  };
}

export class AuthClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthClientError';
  }
}
