/**
 * Instant revocation, without reading the database on every request.
 *
 * ## The problem it solves
 *
 * An access token is verified from its signature alone — no database read — and
 * that is the trade that keeps authentication off the hot path. The cost is a
 * window: revoking a session sets `revokedAt` on a row nothing reads until the
 * next refresh, so a revoked or stolen token keeps working for the rest of its
 * life. Shortening `AUTH_ACCESS_TOKEN_TTL` BOUNDS that window. Only this CLOSES
 * it.
 *
 * ## Why it is affordable
 *
 * Entries live exactly as long as an access token can, then expire on their own.
 * So the store only ever holds sessions revoked in the last few minutes — a
 * handful of keys, not a table — and the check is an O(1) lookup rather than a
 * query. That is the whole reason this is cheaper than "just check the row".
 *
 * ## Two kinds of entry, because there are two kinds of revocation
 *
 *   BY SESSION   sign out this device; change password (every session but this
 *                one). Needs the ids, because one session is spared.
 *   BY USER      sign out everywhere; password reset. One entry covers every
 *                token issued at or before an instant, however many sessions
 *                there were — and it keeps covering tokens that were in flight
 *                when the revocation happened.
 *
 * A user entry compares against the token's `iat`, which is why `Principal`
 * carries `issuedAt`. Comparing against `exp` would be wrong: two tokens issued
 * seconds apart can share an expiry, and the newer one — minted by a legitimate
 * sign-in after the revocation — must survive.
 */

export const SESSION_REVOCATION_STORE = 'kwtech:auth-revocation-store';

export interface RevocationQuery {
  userId: string;
  sessionId: string;
  /** The token's `iat`, epoch seconds. */
  issuedAt: number;
}

export interface SessionRevocationStore {
  /** Refuse these sessions for `ttlSeconds`. */
  revokeSessions(sessionIds: readonly string[], ttlSeconds: number): void | Promise<void>;
  /**
   * Refuse every token for this user issued at or before `at` (epoch seconds),
   * for `ttlSeconds`.
   */
  revokeUserBefore(userId: string, at: number, ttlSeconds: number): void | Promise<void>;
  /** True when this token must be refused despite a valid signature. */
  isRevoked(query: RevocationQuery): boolean | Promise<boolean>;
}

/**
 * The default: a Map in this process.
 *
 * ⚠️ **CORRECT FOR EXACTLY ONE API INSTANCE.** A second replica has its own Map
 * and will happily accept a token the first one just revoked — so this closes
 * the window on a single-node deployment and silently fails to on a scaled one.
 * That is the same shape of caveat `graphql-subscriptions`' in-memory PubSub
 * carries (PLAN §7), and the same answer applies: swap in a Redis-backed store
 * when a second replica appears. `AuthModule.forRoot({ revocationStore })` is
 * the seam; nothing else changes.
 *
 * Chosen as the default anyway because the alternative — no store — means no
 * revocation at all, and because an app that never scales past one node should
 * not have to run Redis to get correct sign-out.
 */
export class InMemoryRevocationStore implements SessionRevocationStore {
  /** sessionId → epoch ms after which the entry is meaningless. */
  private readonly sessions = new Map<string, number>();
  /** userId → { until, revokedBefore } */
  private readonly users = new Map<string, { until: number; revokedBefore: number }>();

  revokeSessions(sessionIds: readonly string[], ttlSeconds: number): void {
    const until = Date.now() + ttlSeconds * 1000;
    for (const id of sessionIds) this.sessions.set(id, until);
    this.sweep();
  }

  revokeUserBefore(userId: string, at: number, ttlSeconds: number): void {
    const until = Date.now() + ttlSeconds * 1000;
    const existing = this.users.get(userId);
    // Keep the LATER cut-off. Two revocations in quick succession must not let
    // the earlier one narrow what the later one already refused.
    this.users.set(userId, {
      until: Math.max(existing?.until ?? 0, until),
      revokedBefore: Math.max(existing?.revokedBefore ?? 0, at),
    });
    this.sweep();
  }

  isRevoked({ userId, sessionId, issuedAt }: RevocationQuery): boolean {
    const now = Date.now();

    const sessionUntil = this.sessions.get(sessionId);
    if (sessionUntil !== undefined && sessionUntil > now) return true;

    const user = this.users.get(userId);
    // `<=` not `<`: a token minted in the same second as the revocation is on
    // the wrong side of it. Refusing it costs one re-sign-in; accepting it is
    // the hole.
    if (user && user.until > now && issuedAt <= user.revokedBefore) return true;

    return false;
  }

  /**
   * Drops expired entries on write rather than on a timer.
   *
   * A `setInterval` in a library keeps a Node process alive and has to be
   * unref'd, cleared on shutdown, and reasoned about in tests. Sweeping on write
   * costs nothing on a store this small and needs none of that — and writes are
   * rare, because a write is somebody signing out.
   */
  private sweep(): void {
    const now = Date.now();
    for (const [id, until] of this.sessions) if (until <= now) this.sessions.delete(id);
    for (const [id, entry] of this.users) if (entry.until <= now) this.users.delete(id);
  }

  /** For tests and diagnostics. Not part of the interface. */
  size(): { sessions: number; users: number } {
    this.sweep();
    return { sessions: this.sessions.size, users: this.users.size };
  }
}
