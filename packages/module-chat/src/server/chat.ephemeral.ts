/**
 * The EPHEMERAL TIER: who is here, and who is typing.
 *
 * ⚠ NEITHER OF THESE EVER GOES IN POSTGRES. A row reading `online` after the
 * process died is a lie that persists, and it would be a write per socket
 * event. Availability — what somebody DECLARES about themselves — is the other
 * half of this feature and is the only part with a table.
 *
 * ⚠ AND NEITHER SURVIVES MORE THAN ONE REPLICA. Pub/sub across replicas fails
 * silently; presence across them fails LOUDLY and constantly, because replica A
 * cannot see the sockets replica B holds and half of everybody shows as offline
 * forever. That is safe TODAY only because `assertRealtimeTopology` refuses to
 * boot on more than one replica — the check is what makes this correct rather
 * than lucky, and it is what has to be relaxed when Redis lands (PLAN §12.28).
 *
 * Everything here is a plain object over an injected clock, so the three traps
 * below are argued with in a test rather than watched for in production.
 */

export interface EphemeralOptions {
  /**
   * ⚠ HOW LONG SOMEBODY STAYS ONLINE AFTER THEIR LAST SOCKET CLOSES, and the
   * trap it exists for is not a rare one.
   *
   * `closeWhenAuthorizationExpires` drops every socket when its access token
   * runs out — by design, and on a timer nobody controls. Publishing offline
   * immediately means every user in the system visibly flickers offline every
   * time their token turns over, forever, and the reconnect a moment later
   * flickers them back. The grace has to outlast a reconnect.
   */
  graceMs: number;
  /**
   * ⚠ HOW LONG A SOCKET IS BELIEVED WITHOUT A HEARTBEAT.
   *
   * An ungraceful disconnect never fires a close event: a closed laptop lid
   * delivers no goodbye, and the socket is simply never heard from again. So
   * presence EXPIRES rather than trusting a farewell that may not come. A
   * client that is still there says so; one that is gone stops saying anything
   * and falls out on its own.
   */
  ttlMs: number;
  /**
   * How often one person's typing may be announced in one conversation.
   *
   * Typing is the highest-frequency write in the product — one per person per
   * conversation every few seconds while anybody is writing — so the signal is
   * throttled here rather than trusted to be. ⚠ A client's indicator must
   * expire SLOWER than this or it flickers between pings.
   */
  typingThrottleMs: number;
  /** How long one typing signal stands before it means nothing. */
  typingTtlMs: number;
}

export const DEFAULT_EPHEMERAL: EphemeralOptions = {
  // Comfortably longer than a reconnect, comfortably shorter than a coffee.
  graceMs: 30_000,
  ttlMs: 90_000,
  typingThrottleMs: 3_000,
  typingTtlMs: 6_000,
};

/**
 * Who is here, counted by SOCKET rather than by person.
 *
 * ⚠ A REFCOUNT, NOT A BOOLEAN. One person is several sockets — tabs, a phone, a
 * second window — and closing one of them must not take them offline. A boolean
 * gets this wrong in the direction nobody notices while testing alone.
 *
 * ⚠ AND IT PUBLISHES ON TRANSITION ONLY. Five tabs opening must be one "came
 * online", not five: every subscriber's client would otherwise redraw five
 * times, and the fan-out is per conversation partner.
 */
export class PresenceRegistry {
  /** userId → socketId → when that socket was last heard from. */
  private readonly sockets = new Map<string, Map<string, number>>();
  /** userId → when their last socket went away. The grace period runs from here. */
  private readonly emptiedAt = new Map<string, number>();
  /** Who the world has been TOLD is online, which is what makes a transition one. */
  private readonly announced = new Set<string>();

  constructor(private readonly options: EphemeralOptions = DEFAULT_EPHEMERAL) {}

  /** @returns true only when this is news — the person was not online before. */
  connect(userId: string, socketId: string, now: number): boolean {
    const forUser = this.sockets.get(userId) ?? new Map<string, number>();
    forUser.set(socketId, now);
    this.sockets.set(userId, forUser);
    this.emptiedAt.delete(userId);

    if (this.announced.has(userId)) return false;
    this.announced.add(userId);
    return true;
  }

  /**
   * One socket went away.
   *
   * ⚠ PUBLISHES NOTHING, EVER. Offline is decided by the passage of time, in
   * `sweep` — because the grace period is the whole point, and a disconnect
   * that announced offline immediately would be the flicker this class exists
   * to prevent.
   */
  disconnect(userId: string, socketId: string, now: number): void {
    const forUser = this.sockets.get(userId);
    if (!forUser) return;

    forUser.delete(socketId);
    if (forUser.size > 0) return;

    this.sockets.delete(userId);
    this.emptiedAt.set(userId, now);
  }

  /** A socket saying it is still there. Resets its share of the TTL. */
  touch(userId: string, socketId: string, now: number): void {
    const forUser = this.sockets.get(userId);
    if (forUser?.has(socketId)) forUser.set(socketId, now);
  }

  isOnline(userId: string, now: number): boolean {
    const live = this.liveSockets(userId, now);
    if (live > 0) return true;

    const emptied = this.emptiedAt.get(userId);
    return emptied !== undefined && now - emptied < this.options.graceMs;
  }

  /** The subset of these people who are here — one pass, for a page of a list. */
  onlineAmong(userIds: readonly string[], now: number): string[] {
    return userIds.filter((userId) => this.isOnline(userId, now));
  }

  /**
   * Everybody who has just stopped being online, and forgets them.
   *
   * ⚠ THE ONLY PLACE OFFLINE IS DECIDED. Both ways of leaving end here — a
   * clean disconnect whose grace has run out, and a socket that stopped
   * answering — so there is one rule and one publish site rather than two that
   * can disagree.
   */
  sweep(now: number): string[] {
    const gone: string[] = [];

    for (const userId of [...this.announced]) {
      if (this.isOnline(userId, now)) continue;
      this.announced.delete(userId);
      this.sockets.delete(userId);
      this.emptiedAt.delete(userId);
      gone.push(userId);
    }
    return gone;
  }

  private liveSockets(userId: string, now: number): number {
    const forUser = this.sockets.get(userId);
    if (!forUser) return 0;

    let live = 0;
    for (const [socketId, lastSeen] of forUser) {
      // A socket nobody has heard from is not a socket. Dropped here rather
      // than only in the sweep, so a stale entry cannot hold somebody online.
      if (now - lastSeen > this.options.ttlMs) forUser.delete(socketId);
      else live += 1;
    }
    return live;
  }
}

/**
 * Who is typing, and for how much longer anybody should believe it.
 *
 * ⚠ IT EXPIRES; IT IS NEVER STOPPED. A "stopped typing" event is one the tab
 * closing mid-word never sends, and the indicator would stick forever — which
 * is the single most common way this feature is built wrong. The client pings
 * while typing continues and the signal simply runs out.
 */
export class TypingRegistry {
  /** `conversationId<NUL>userId` → when it was last ANNOUNCED. */
  private readonly announced = new Map<string, number>();

  constructor(private readonly options: EphemeralOptions = DEFAULT_EPHEMERAL) {}

  /**
   * @returns true when this ping is worth telling anybody about.
   *
   * Throttled, because the alternative is a publish per keystroke-burst per
   * person per conversation, fanned out to every participant.
   */
  shouldAnnounce(conversationId: string, userId: string, now: number): boolean {
    const key = this.key(conversationId, userId);
    const last = this.announced.get(key);
    if (last !== undefined && now - last < this.options.typingThrottleMs) return false;

    this.announced.set(key, now);
    return true;
  }

  /** Who is typing in this conversation right now, ignoring anything stale. */
  typingIn(conversationId: string, now: number): string[] {
    const typing: string[] = [];
    for (const [key, at] of this.announced) {
      if (now - at > this.options.typingTtlMs) {
        this.announced.delete(key);
        continue;
      }
      const [conversation, userId] = key.split(SEPARATOR);
      if (conversation === conversationId && userId) typing.push(userId);
    }
    return typing;
  }

  /**
   * Everything this person was typing, dropped.
   *
   * Called when they go offline: an indicator that outlives the person it
   * describes is the same bug as a presence row that outlives the process.
   */
  forget(userId: string): void {
    for (const key of [...this.announced.keys()]) {
      if (key.endsWith(`${SEPARATOR}${userId}`)) this.announced.delete(key);
    }
  }

  private key(conversationId: string, userId: string): string {
    return `${conversationId}${SEPARATOR}${userId}`;
  }
}

/**
 * NUL, which cannot appear in a cuid or in any id this module handles — so no
 * pair of values can collide with another pair's concatenation, and `forget`
 * cannot match a conversation id that merely ends the way a user id does.
 *
 * ⚠ WRITTEN AS AN ESCAPE, never as a literal control character in the source. A
 * real NUL byte in a file is invisible in every editor, makes the file binary
 * to `grep`, and survives a copy-paste as something else entirely.
 */
const SEPARATOR = '\u0000';
