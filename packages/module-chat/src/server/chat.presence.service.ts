import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit, Optional } from '@nestjs/common';
import { effectiveAvailability, mayAnnounceTyping, publishedPresence } from '../domain/availability.js';
import type { Availability } from '../types.js';
import { DEFAULT_EPHEMERAL, type EphemeralOptions, PresenceRegistry, TypingRegistry } from './chat.ephemeral.js';
import { CHAT_EVENT, type ChatPubSub, NULL_CHAT_PUBSUB } from './chat.pubsub.js';
import type { ChatPrismaClient } from './chat.repository.js';
import { CHAT_PRISMA, CHAT_PUBSUB } from './chat.tokens.js';

/**
 * Who is here, what they say about themselves, and who is typing.
 *
 * The registries hold the rules; this drives them — it owns the clock, the
 * sweep, and the one question neither of them can answer: WHO IS ALLOWED TO
 * KNOW.
 *
 * ## ⚠ PRESENCE IS A SURVEILLANCE SURFACE AND AN ENUMERATION ORACLE
 *
 * A `userPresence(userId)` that answered for anybody would undo the thing the
 * directory is exact-email-only to avoid — it would confirm an account exists —
 * and add a worse one: when a named person works, readable by anyone who can
 * guess their id.
 *
 * So presence resolves ONLY between people who share an ACTIVE conversation.
 * That is `canAccessConversation`'s rule for the third time, and it is also the
 * audience every publish is filtered by. Nobody learns anything about somebody
 * they could not already message.
 */
@Injectable()
export class ChatPresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ChatPresence');
  private readonly presence: PresenceRegistry;
  private readonly typing: TypingRegistry;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(CHAT_PRISMA) private readonly prisma: ChatPrismaClient,
    @Optional() @Inject(CHAT_PUBSUB) private readonly pubsub?: ChatPubSub,
    @Optional() options?: EphemeralOptions,
  ) {
    const resolved = options ?? DEFAULT_EPHEMERAL;
    this.presence = new PresenceRegistry(resolved);
    this.typing = new TypingRegistry(resolved);
    this.sweepMs = Math.max(1_000, Math.floor(resolved.graceMs / 3));
  }

  /**
   * How often the sweep runs.
   *
   * ⚠ A FRACTION OF THE GRACE, not a round number picked by hand. Offline is
   * decided by time passing, so the sweep is the only thing that notices — and
   * a tick longer than the grace would make the grace meaningless, since
   * somebody could be gone for a whole grace period before anything looked.
   */
  private readonly sweepMs: number;

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), this.sweepMs);
    // Do not hold the process open for a timer whose whole job is other
    // people's socket lifetimes.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private get engine(): ChatPubSub {
    return this.pubsub ?? NULL_CHAT_PUBSUB;
  }

  // ── the socket's two events ───────────────────────────────────────────────

  /**
   * A socket opened.
   *
   * ⚠ PUBLISHES ONLY ON A TRANSITION. The second tab is not news, and the
   * fan-out is per conversation partner.
   */
  async connected(userId: string, socketId: string): Promise<void> {
    if (!this.presence.connect(userId, socketId, Date.now())) return;
    await this.announce(userId);
  }

  /**
   * A socket closed.
   *
   * ⚠ ANNOUNCES NOTHING, deliberately. Offline is the sweep's decision, after
   * the grace period — and the grace exists because the socket is dropped every
   * time an access token turns over, which would otherwise flicker every user
   * in the system offline and back on a timer nobody controls.
   */
  disconnected(userId: string, socketId: string): void {
    this.presence.disconnect(userId, socketId, Date.now());
  }

  /** A socket saying it is still there, against the TTL. */
  heartbeat(userId: string, socketId: string): void {
    this.presence.touch(userId, socketId, Date.now());
  }

  // ── reading ───────────────────────────────────────────────────────────────

  /**
   * What the viewer may be told about these people.
   *
   * ⚠ FILTERED TO THE VIEWER'S OWN PARTNERS, here rather than by the caller. A
   * resolver that passed a list of ids straight through would be the
   * enumeration oracle this class exists to avoid — so the ids that are not
   * partners are silently dropped rather than refused, which tells a prober
   * nothing either way.
   */
  async presenceFor(
    actorId: string,
    userIds: readonly string[],
  ): Promise<Map<string, ReturnType<typeof publishedPresence>>> {
    const partners = await this.partnersOf(actorId);
    const visible = userIds.filter((userId) => partners.has(userId));
    const declared = await this.availabilities(visible);
    const now = Date.now();

    return new Map(
      visible.map((userId) => [
        userId,
        publishedPresence(declared.get(userId) ?? 'available', this.presence.isOnline(userId, now)),
      ]),
    );
  }

  /**
   * Does this person hold a live socket right now?
   *
   * ⚠ UNFILTERED, unlike `presenceFor` above — and that is safe only because
   * of who asks. `presenceFor` answers a VIEWER about other people, so it drops
   * anybody they share no conversation with, or it becomes the enumeration
   * oracle this class exists to avoid. This answers the SERVER about somebody it
   * is already about to act on: it is called from `notifyAbsent`, for a
   * participant of a conversation a message was just written into, and its
   * answer reaches nobody — it decides whether to send an email.
   *
   * ⚠ It says nothing about `invisible`. Somebody appearing offline still holds
   * a socket, so they are still reading, and mailing them would both waste the
   * mail and leak their presence by the side door — an email that arrives only
   * when you are away tells the sender when you were away.
   */
  isOnline(userId: string): boolean {
    return this.presence.isOnline(userId, Date.now());
  }

  /** Who is writing in this conversation right now. The caller checks participation. */
  whoIsTyping(conversationId: string): string[] {
    return this.typing.typingIn(conversationId, Date.now());
  }

  // ── writing ───────────────────────────────────────────────────────────────

  /**
   * Somebody is writing. The caller has already checked they are in it.
   *
   * ⚠ Throttled AND checked against `invisible`: a hidden person whose typing
   * indicator appears has leaked through the side door, and typing is the
   * louder signal — it says not only that they are there but that they are
   * writing to you.
   */
  async noteTyping(conversationId: string, userId: string): Promise<void> {
    const now = Date.now();
    if (!this.typing.shouldAnnounce(conversationId, userId, now)) return;

    const declared = await this.availabilityOf(userId);
    if (!mayAnnounceTyping(declared)) return;

    const audience = await this.activeIn(conversationId);
    // The typist is not told they are typing.
    const others = audience.filter((one) => one !== userId);
    if (others.length === 0) return;

    await this.safely(() => this.engine.publish(CHAT_EVENT.typing, { audience: others, conversationId, userId }));
  }

  /**
   * Availability changed, so everybody who may know is told.
   *
   * Called by the write service after the row is saved — the same
   * after-the-commit rule every other publish here follows.
   */
  async availabilityChanged(userId: string): Promise<void> {
    await this.announce(userId);
  }

  // ── the sweep ─────────────────────────────────────────────────────────────

  /**
   * Everybody whose grace has run out, or whose socket stopped answering.
   *
   * Public so a test can run one tick rather than wait for an interval.
   */
  async sweep(): Promise<void> {
    for (const userId of this.presence.sweep(Date.now())) {
      // ⚠ An indicator that outlives the person it describes is the same bug as
      // a presence row that outlives the process.
      this.typing.forget(userId);
      await this.announce(userId);
    }
  }

  // ── the one publish ───────────────────────────────────────────────────────

  /**
   * One person's presence, to everyone entitled to it.
   *
   * ⚠ THE AUDIENCE IS RE-READ PER PUBLISH, like every other event this module
   * sends: a subscription is authorised once, and somebody who left the last
   * conversation they shared with this person must stop hearing about them.
   *
   * ⚠ FAN-OUT IS BOUNDED PER PUBLISH, not per subscriber. One topic, filtered
   * against the recipient's own conversation partners. Naive presence is O(n²);
   * this is the same mechanism messages already use and needs no new machinery.
   */
  private async announce(userId: string): Promise<void> {
    await this.safely(async () => {
      const partners = await this.partnersOf(userId);
      partners.delete(userId);
      if (partners.size === 0) return;

      const declared = await this.availabilityOf(userId);
      const view = publishedPresence(declared, this.presence.isOnline(userId, Date.now()));

      await this.engine.publish(CHAT_EVENT.presence, {
        audience: [...partners],
        userId,
        online: view.online,
        availability: view.availability,
      });
    });
  }

  // ── the queries ───────────────────────────────────────────────────────────

  /**
   * Everybody who shares an ACTIVE conversation with this person.
   *
   * ⚠ ACTIVE on BOTH SIDES. An invitation is not a relationship: somebody who
   * has been invited and not answered must not learn when the person who
   * invited them is at their desk, which would turn an unanswered invitation
   * into a tracking device.
   */
  private async partnersOf(userId: string): Promise<Set<string>> {
    const mine = await this.prisma.chatParticipant.findMany({ where: { userId, status: 'active' } });
    if (mine.length === 0) return new Set();

    const everyone = await this.prisma.chatParticipant.findMany({
      where: { conversationId: { in: mine.map((row) => row.conversationId) }, status: 'active' },
    });
    return new Set(everyone.map((row) => row.userId));
  }

  private async activeIn(conversationId: string): Promise<string[]> {
    const rows = await this.prisma.chatParticipant.findMany({ where: { conversationId, status: 'active' } });
    return rows.map((row) => row.userId);
  }

  private async availabilityOf(userId: string): Promise<Availability> {
    const row = await this.prisma.chatAvailability.findUnique({ where: { userId } });
    return effectiveAvailability(row, new Date());
  }

  private async availabilities(userIds: readonly string[]): Promise<Map<string, Availability>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.chatAvailability.findMany({ where: { userId: { in: [...userIds] } } });
    const now = new Date();
    return new Map(rows.map((row) => [row.userId, effectiveAvailability(row, now)]));
  }

  /** Presence is an enhancement; a failure to publish one must not raise. */
  private async safely(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.error(`Presence could not be published: ${(error as Error).message}`);
    }
  }
}
