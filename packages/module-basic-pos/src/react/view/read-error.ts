/**
 * What a failed read says, in words: the API's own message, or the screen's
 * fallback when there is none.
 *
 * ⚠ NEVER AN EMPTY STRING. A read that failed with `Error('')` (the client
 * can build one from a GraphQL error with no message) would store `''`, and a
 * screen reading "no error" from it would treat a failed read as a good one —
 * printing the last copy of an order as if it were current, and saying
 * nothing. The fallback is always a sentence.
 */
export function readError(caught: unknown, fallback: string): string {
  if (caught instanceof Error && caught.message.trim() !== '') return caught.message;
  return fallback;
}
