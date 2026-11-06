import type { LocalNetworkRefusal } from '../types.js';

/** One sentence per refusal. */
export function localNetworkRefusalMessage(reason: LocalNetworkRefusal): string {
  switch (reason) {
    case 'not_signed_in':
      return 'Your session has ended. Sign in again.';
  }
}

/** The module's one error class: a refusal with its reason, and a sentence for the person. */
export class LocalNetworkError extends Error {
  constructor(
    readonly reason: LocalNetworkRefusal,
    message: string = localNetworkRefusalMessage(reason),
  ) {
    super(message);
    this.name = 'LocalNetworkError';
  }
}
