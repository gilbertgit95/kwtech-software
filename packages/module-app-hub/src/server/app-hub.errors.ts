/**
 * One error type for every refusal an Apps page write makes, with a REASON
 * CODE, not only a message — a caller should not regex a sentence to tell a bad
 * layout from a missing sign-in.
 */
export type AppHubRefusal = 'not_permitted' | 'invalid';

export class AppHubWriteError extends Error {
  constructor(
    readonly reason: AppHubRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'AppHubWriteError';
  }
}
