import { Inject, Injectable, Optional } from '@nestjs/common';
import { effectiveAvailability } from '../domain/availability.js';
import { isContactBlocked } from '../domain/blocking.js';
import { countsAsUnread, MAX_CATCH_UP, pageSize } from '../domain/messages.js';
import { canAccessConversation, isLiveParticipant } from '../domain/participation.js';
import type { Availability, BlockView } from '../types.js';
import { ChatWriteError } from './chat.errors.js';
import type { ChatPrismaClient, ConversationRow, KeysetClause, MessageRow, ParticipantRow } from './chat.repository.js';
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
   * ⚠ A CONSTANT NUMBER OF QUERIES, never a count per conversation per render —
   * which is how the panel becomes the slowest thing in the app. Five: the
   * viewer's own rows, the conversations, everybody in them, the unread marks,
   * and one grouped count. Five for one conversation and five for two hundred.
   *
   * ⚠ This comment CLAIMED that before it was true — unread was a `findUnique`
   * plus a `count` per conversation underneath it, so the real figure was
   * `3 + 2n`. See `unreadByConversation`.
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

    const unread = await this.unreadByConversation(actorId, mine);

    const summaries = conversations.map((conversation) => {
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
        unread: unread.get(conversation.id) ?? 0,
      };
    });

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
      /*
       * ⚠ THE SAME FUNCTION THE LIST USES, called with one row. A second
       * implementation for the single case is how a detail view and the list
       * beside it come to disagree about the same number — and the rule it
       * would have to restate (three exclusions and a keyset boundary) is
       * exactly the kind that gets restated slightly wrong.
       */
      unread: (await this.unreadByConversation(actorId, [me])).get(conversationId) ?? 0,
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

  /**
   * HOW MUCH IS WAITING, per conversation, in two queries for all of them.
   *
   * ## ⚠ Why this is not a count per conversation
   *
   * It was, and the cost was quadratic in the wrong place. Every render of the
   * list, and every re-read the nav badge does when ANYBODY sends this person a
   * message, ran a `findUnique` for the mark plus a `count` for the tail — per
   * conversation. A person in twenty conversations paid forty round trips to
   * answer one number, on the hottest path in the product. The plan called this
   * out before it was built ("ONE GROUPED QUERY, never a COUNT per conversation
   * per render, which is how the panel becomes the slowest thing in the app")
   * and the comment above `listConversations` claimed it was already true.
   *
   * ## What makes it groupable
   *
   * The three exclusions are the same for every conversation; only the CUT-OFF
   * differs, because each is counted from this viewer's own mark. So the marks
   * are read in one query, the boundaries become one `OR` of per-conversation
   * clauses, and the database groups.
   *
   * ⚠ THE KEYSET PAIR, not the id. `id: { gt }` alone would rely on ids
   * sorting the way time does, and cuid only roughly does — one out-of-order id
   * is a message that never clears or never counts.
   *
   * ⚠ A MARK THAT NO LONGER RESOLVES COUNTS EVERYTHING, which is the same
   * reading the per-conversation version made: an unknown boundary must fail
   * towards "there is something to read", because the other direction hides a
   * message behind a badge that says nothing is waiting.
   *
   * @param mine the viewer's own participant rows. INVITED rows are dropped
   *   here rather than by the caller: an invitation shows who sent it and not
   *   one word of what was said (§12.51), so counting its messages would put a
   *   number on a thread the viewer is refused.
   * @returns conversation id to count. A conversation with nothing waiting is
   *   ABSENT rather than zero — `groupBy` returns no row for an empty group,
   *   and inventing one would mean walking the whole list to do it.
   */
  async unreadByConversation(actorId: string, mine: readonly ParticipantRow[]): Promise<Map<string, number>> {
    const readable = mine.filter((row) => canAccessConversation(row));
    if (readable.length === 0) return new Map();

    const markIds = readable.map((row) => row.lastReadMessageId).filter((id): id is string => id !== null);
    const marks = markIds.length ? await this.prisma.chatMessage.findMany({ where: { id: { in: markIds } } }) : [];
    const markById = new Map(marks.map((row) => [row.id, row]));

    /*
     * One clause per conversation: everything in it, or everything in it after
     * this viewer's mark. Built as an OR so a single `groupBy` can answer for
     * all of them at once.
     */
    const clauses = readable.map((row) => {
      const mark = row.lastReadMessageId ? markById.get(row.lastReadMessageId) : undefined;
      if (!mark) return { conversationId: row.conversationId };
      return {
        conversationId: row.conversationId,
        OR: [{ createdAt: { gt: mark.createdAt } }, { createdAt: mark.createdAt, id: { gt: mark.id } }] as const,
      };
    });

    const groups = await this.prisma.chatMessage.groupBy({
      by: ['conversationId'],
      where: {
        // The per-message half of the rule lives in the domain; these are the
        // same three exclusions expressed as a query. `countsAsUnread` is what
        // the tests assert against, and it is asserted to agree with this.
        kind: 'user',
        deletedAt: null,
        authorId: { not: actorId },
        OR: clauses as { conversationId: string; OR?: KeysetClause<'gt'> }[],
      },
      _count: { _all: true },
    });

    return new Map(groups.map((group) => [group.conversationId, group._count._all]));
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
