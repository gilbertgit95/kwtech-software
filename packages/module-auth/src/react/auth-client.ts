'use client';

import type { AuthResult } from '../types.js';

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
  signIn(input: { identifier: string; password: string }): Promise<AuthResult>;
  requestPasswordReset(input: { email: string }): Promise<void>;
  resetPassword(input: { token: string; password: string }): Promise<void>;
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

  return {
    signIn: (input) => post('/signin', input),
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
