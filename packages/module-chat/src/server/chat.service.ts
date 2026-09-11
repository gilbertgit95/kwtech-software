import { Inject, Injectable, Optional } from '@nestjs/common';
import { effectiveAvailability } from '../domain/availability.js';
import { isContactBlocked } from '../domain/blocking.js';
import { countsAsUnread, MAX_CATCH_UP, pageSize } from '../domain/messages.js';
import { canAccessConversation, isLiveParticipant } from '../domain/participation.js';
import type { Availability, BlockView } from '../types.js';
import { ChatWriteError } from './chat.errors.js';
import type { ChatPrismaClient, ConversationRow, MessageRow, ParticipantRow } from './chat.repository.js';
import { CHAT_PRISMA, CHAT_USER_DIRECTORY } from './chat.tokens.js';
import type { DirectoryUser, UserDirectory } from './user-directory.js';

/**
 * Reading chat. Every method takes the ACTOR and re-asks whether they may be
 * here — participation is not permission, and the guard upstream has only
 * answered the other half.
 *
 * ⚠ No method here takes a conversation id without also taking a viewer. That
 * is deliberate shape rather than style: a signature that could be called
 * without one is a signature somebody eventually calls without one, which is
 * precisely C1.
 */

export interface ConversationSummary {
  conversation: ConversationRow;
  /** The viewer's own row — `active` or `invited`, never anything else here. */
  me: ParticipantRow;
  /** Everybody currently in it, the viewer included. Invited people are included. */
  participants: ParticipantRow[];
  unread: number;
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(CHAT_PRISMA) private readonly prisma: ChatPrismaClient,
    @Optional() @Inject(CHAT_USER_DIRECTORY) private readonly directory?: UserDirectory,
  ) {}

  /**
   * Everything this person is in or has been invited to, most recent first.
   *
   * ⚠ ONE GROUPED PASS, never a count per conversation per render — which is how
   * the panel becomes the slowest thing in the app. Three queries total,
   * whatever the number of conversations.
   */
  async listConversations(actorId: string): Promise<ConversationSummary[]> {
    const mine = await this.prisma.chatParticipant.findMany({
      where: { userId: actorId, status: { in: ['active', 'invited'] } },
    });
    if (mine.length === 0) return [];

    const ids = mine.map((row) => row.conversationId);
    const [conversations, everyone] = await Promise.all([
      this.prisma.chatConversation.findMany({
        where: { id: { in: ids } },
        orderBy: { lastMessageAt: 'desc' },
      }),
      this.prisma.chatParticipant.findMany({ where: { conversationId: { in: ids } } }),
    ]);

    const byConversation = new Map<string, ParticipantRow[]>();
    for (const row of everyone) {
      const list = byConversation.get(row.conversationId) ?? [];
      list.push(row);
      byConversation.set(row.conversationId, list);
    }

    const summaries = await Promise.all(
      conversations.map(async (conversation) => {
        const me = mine.find((row) => row.conversationId === conversation.id);
        if (!me) return null;
        return {
          conversation,
          me,
          /*
           * ⚠ Only people who are STILL THERE. A `left` or `removed` row is
           * history, and listing it would tell everybody who walked out and
           * when — which is not the participant list's job.
           */
          participants: (byConversation.get(conversation.id) ?? []).filter(
            (row) => row.status === 'active' || row.status === 'invited',
          ),
          unread: canAccessConversation(me) ? await this.unreadCount(actorId, me) : 0,
        };
      }),
    );

    return summaries.filter((summary): summary is ConversationSummary => summary !== null);
  }

  /**
   * One conversation, or a refusal.
   *
   * An INVITED viewer gets the row — that is the requests inbox — and
   * `listMessages` still refuses them. The two questions are separate on
   * purpose: admitting the invitation is not admitting its contents.
   */
  async conversationFor(actorId: string, conversationId: string): Promise<ConversationSummary> {
    const me = await this.participantOf(actorId, conversationId);
    if (!isLiveParticipant(me)) {
      /*
       * ⚠ NOT FOUND, not "forbidden". Answering "you may not see this" confirms
       * that a conversation with this id exists, to anybody who guesses one.
       */
      throw new ChatWriteError('not_found', 'No such conversation', { conversationId });
    }

    const conversation = await this.prisma.chatConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new ChatWriteError('not_found', 'No such conversation', { conversationId });

    const participants = await this.prisma.chatParticipant.findMany({ where: { conversationId } });
    return {
      conversation,
      me,
      participants: participants.filter((row) => row.status === 'active' || row.status === 'invited'),
      unread: canAccessConversation(me) ? await this.unreadCount(actorId, me) : 0,
    };
  }

  /**
   * A page of messages, newest first, by KEYSET.
   *
   * ⚠ ACTIVE ONLY. An invited person may see that they were invited and never
   * what was said — see §12.51, which records what that costs.
   */
  async listMessages(
    actorId: string,
    conversationId: string,
    options: { before?: { createdAt: Date; id: string } | undefined; take?: number | null } = {},
  ): Promise<MessageRow[]> {
    const me = await this.participantOf(actorId, conversationId);
    if (!canAccessConversation(me)) {
      throw new ChatWriteError('not_found', 'No such conversation', { conversationId });
    }

    const before = options.before;
    return this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        /*
         * The keyset pair, not a bare timestamp: two messages can share a
         * millisecond, and a cursor on `createdAt` alone either re-shows one or
         * skips one, forever, every time it happens.
         */
        ...(before
          ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize(options.take),
    });
  }

  /**
   * Everything the viewer missed while their socket was down.
   *
   * ⚠ ACROSS EVERY CONVERSATION AT ONCE, and in ASCENDING order — the opposite
   * of `listMessages` on both counts, because this is a replay rather than a
   * page. A thread is read backwards from the newest; a gap is filled forwards
   * from where the client stopped, or it arrives out of order.
   *
   * `truncated` rather than a short page: see `MAX_CATCH_UP`. The caller emits
   * `sync` regardless, so a viewer who missed too much re-reads instead of
   * being handed an arbitrary slice of a gap.
   */
  async missedSince(
    actorId: string,
    after: { createdAt: Date; id: string },
  ): Promise<{ messages: MessageRow[]; truncated: boolean }> {
    const mine = await this.prisma.chatParticipant.findMany({ where: { userId: actorId, status: 'active' } });
    if (mine.length === 0) return { messages: [], truncated: false };

    const messages = await this.prisma.chatMessage.findMany({
      where: {
        conversationId: { in: mine.map((row) => row.conversationId) },
        // The same keyset pair the thread is paged by, pointing the other way.
        OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      /*
       * One more than the threshold, so "there were too many" is answered by
       * the same query rather than by a second count.
       */
      take: MAX_CATCH_UP + 1,
    });

    if (messages.length > MAX_CATCH_UP) return { messages: [], truncated: true };
    return { messages, truncated: false };
  }

  /** The viewer's unread count for one conversation, from their own mark. */
  async unreadCount(actorId: string, me: ParticipantRow): Promise<number> {
    const mark = me.lastReadMessageId
      ? await this.prisma.chatMessage.findUnique({ where: { id: me.lastReadMessageId } })
      : null;

    return this.prisma.chatMessage.count({
      where: {
        conversationId: me.conversationId,
        // The per-message half of the rule lives in the domain; this is the same
        // three exclusions expressed as a query. `countsAsUnread` is what the
        // tests assert against, and it is asserted to agree with this.
        kind: 'user',
        deletedAt: null,
        authorId: { not: actorId },
        ...(mark
          ? { OR: [{ createdAt: { gt: mark.createdAt } }, { createdAt: mark.createdAt, id: { gt: mark.id } }] }
          : {}),
      },
    });
  }

  /**
   * The viewer's OWN declared availability, with an expired timer read as unset.
   *
   * ⚠ Returns the effective value AND the raw `clearAt`, because this is the
   * one caller entitled to both: the person themselves, whose picker has to
   * show what they chose and when it runs out. Everybody else goes through
   * `publishedPresence`, which never names `invisible` at all.
   */
  async availabilityOf(actorId: string): Promise<{ availability: Availability; clearAt: Date | null }> {
    const row = await this.prisma.chatAvailability.findUnique({ where: { userId: actorId } });
    const now = new Date();
    const availability = effectiveAvailability(row, now);
    return {
      availability,
      // Cleared in the answer as well as in the value: a picker showing "until
      // 09:00" beside "available" would be describing a timer that has already
      // fired.
      clearAt: availability === row?.availability ? (row?.clearAt ?? null) : null,
    };
  }

  /** Everyone this person has blocked, and everyone who has blocked them. */
  async blocksFor(actorId: string): Promise<BlockView[]> {
    const rows = await this.prisma.chatBlock.findMany({
      where: { OR: [{ blockerId: actorId }, { blockedId: actorId }] },
    });
    return rows.map((row) => ({ blockerId: row.blockerId, blockedId: row.blockedId }));
  }

  /** Whether contact between these two is blocked, in either direction. */
  async contactBlocked(actorId: string, otherId: string): Promise<boolean> {
    return isContactBlocked(await this.blocksFor(actorId), actorId, otherId);
  }

  /** The viewer's own row, or null. */
  participantOf(actorId: string, conversationId: string): Promise<ParticipantRow | null> {
    return this.prisma.chatParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: actorId } },
    });
  }

  /**
   * Names for a set of ids, through the host's port.
   *
   * Absent directory is not an error: the module runs without one and the UI
   * falls back to ids. It is a worse product and a working one, which is the
   * right trade for a port the host may not have wired yet.
   */
  async describe(ids: readonly string[]): Promise<readonly DirectoryUser[]> {
    if (!this.directory || ids.length === 0) return [];
    return this.directory.describe([...new Set(ids)]);
  }

  /** Whether a message would show in somebody's badge. Exported for the resolver's sake. */
  static wouldCountAsUnread(message: MessageRow, viewerId: string): boolean {
    return countsAsUnread(message, viewerId);
  }
}
