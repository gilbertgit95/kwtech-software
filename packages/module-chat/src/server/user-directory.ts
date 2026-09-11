/** One person, as chat needs to render them. Never more than this. */
export interface DirectoryUser {
  id: string;
  displayName: string;
}

/**
 * The port that turns an email into somebody, and ids into names.
 *
 * ⚠ `findByEmail` IS EXACT-MATCH ONLY, and that is a security decision the
 * interface cannot enforce — so it is stated here, where an implementer reads
 * it. A prefix search is a far better type-ahead and a full staff directory for
 * anybody holding `chat:directory`. Scoping the search to shared organizations
 * was rejected harder: it contradicts chat being app level, and two people with
 * no organization in common must be able to reach each other.
 *
 * ⚠ An unknown address and a BLOCKED one must be indistinguishable to the
 * caller — same answer, same timing. See `CONTACT_REFUSED_MESSAGE`. This port
 * answers only "does this address exist"; the blocking half is applied above it,
 * which is why it must not be the thing that reveals the difference.
 */
export interface UserDirectory {
  findByEmail(email: string): Promise<DirectoryUser | null>;
  /**
   * Names for a set of ids, in any order. Missing ids are simply absent — a
   * deleted account is not an error in a conversation that still has its
   * messages.
   *
   * ⚠ The implementation is expected to CAP how many it will answer at once;
   * chat calls it with a page of participants, never an unbounded list.
   */
  describe(ids: readonly string[]): Promise<readonly DirectoryUser[]>;
}
