import type { Availability, MessageKind, ParticipantStatus } from '../types.js';

/**
 * The slice of a Prisma client this module uses — declared STRUCTURALLY, never
 * imported from a generated one.
 *
 * The module owns its models and ships them as a `.prisma` fragment; the host
 * composes that into its own schema and hands back the client. So this package
 * has no `@prisma/client` dependency, no generated types, and no opinion about
 * which database the tables are in — which is what lets an app put chat in a
 * second database, as §9 allows.
 *
 * ⚠ It is also why the fake in the tests is a literal object: the interface is
 * the contract, so a fake that satisfies it is as real as the client.
 */

export interface ConversationRow {
  id: string;
  title: string | null;
  icon: string | null;
  directKey: string | null;
  createdById: string;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
}

export interface ParticipantRow {
  id: string;
  conversationId: string;
  userId: string;
  status: ParticipantStatus;
  invitedById: string | null;
  lastReadMessageId: string | null;
  mutedUntil: Date | null;
  joinedAt: Date;
  exitedAt: Date | null;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  kind: MessageKind;
  authorId: string | null;
  body: string | null;
  clientMessageId: string | null;
  replyToMessageId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedById: string | null;
}

export interface BlockRow {
  blockerId: string;
  blockedId: string;
  createdAt: Date;
}

/**
 * What somebody declared about themselves. ⚠ `clearAt` is compared on READ —
 * see `effectiveAvailability`; nothing ever writes an expired value back.
 */
export interface AvailabilityRow {
  userId: string;
  availability: Availability;
  clearAt: Date | null;
}

/**
 * ⚠ KEYSET, not limit/offset.
 *
 * Offset paging over an append-heavy list re-shows rows every time somebody
 * posts while you are scrolling, and the grids in this repo all use offset —
 * which is exactly why this is written out rather than assumed.
 *
 * `before` is the oldest message already held; the page returned is the one
 * BEFORE it, newest first, so scrolling up walks backwards through history.
 */
export interface MessagePageArgs {
  conversationId: string;
  before?: KeysetCursor | undefined;
  take: number;
}

/** One message's position in the thread's ordering. Both halves, always. */
export interface KeysetCursor {
  createdAt: Date;
  id: string;
}

/**
 * "Strictly before" or "strictly after" that position, as Prisma spells it.
 *
 * Written out as a type because it appears in three signatures and every one of
 * them has to be the SAME pair — a call site that drops the tiebreak compiles
 * happily and pages wrongly only when two messages share a millisecond.
 */
export type KeysetClause<D extends 'lt' | 'gt'> = [
  { createdAt: Record<D, Date> },
  { createdAt: Date; id: Record<D, string> },
];

export interface ChatPrismaClient {
  chatConversation: {
    findUnique(args: { where: { id: string } | { directKey: string } }): Promise<ConversationRow | null>;
    findMany(args: {
      where: { id: { in: string[] }; archivedAt?: null };
      orderBy: { lastMessageAt: 'desc' };
    }): Promise<ConversationRow[]>;
    /**
     * ⚠ THE CAP'S COUNT, and the relation filter in it is load-bearing.
     *
     * Live GROUPS this person created AND is still in — `directKey: null`
     * excludes direct chats, `archivedAt: null` lets archiving free a slot, and
     * `participants.some` is the "still in" half that stops
     * create-twenty-and-leave-them-all being unlimited. See `countsTowardCap`,
     * which is the same rule as a pure function over a row already loaded.
     */
    count(args: {
      where: {
        createdById: string;
        archivedAt: null;
        directKey: null;
        participants: { some: { userId: string; status: ParticipantStatus } };
      };
    }): Promise<number>;
  };
  chatParticipant: {
    findUnique(args: {
      where: { conversationId_userId: { conversationId: string; userId: string } };
    }): Promise<ParticipantRow | null>;
    findMany(args: {
      where: {
        userId?: string;
        conversationId?: string | { in: string[] };
        status?: ParticipantStatus | { in: ParticipantStatus[] };
      };
    }): Promise<ParticipantRow[]>;
    count(args: { where: { userId: string; status: ParticipantStatus } }): Promise<number>;
  };
  chatMessage: {
    findUnique(args: { where: { id: string } }): Promise<MessageRow | null>;
    findMany(args: {
      where: {
        conversationId: string | { in: string[] };
        OR?: KeysetClause<'lt'> | KeysetClause<'gt'>;
      };
      orderBy?: ({ createdAt: 'desc' | 'asc' } | { id: 'desc' | 'asc' })[];
      take?: number;
    }): Promise<MessageRow[]>;
    /**
     * Unread, counted in the database rather than by loading the tail.
     *
     * ⚠ THE KEYSET CLAUSE IS THE WHOLE CORRECTNESS OF THE BADGE.
     * `id: { gt }` alone would rely on ids sorting the way time does, and cuid
     * only ROUGHLY does — one out-of-order id is a message that never clears or
     * never counts. So "after my mark" is `(createdAt, id)` against the marked
     * message's own pair, which is exactly the order the thread is paged in.
     */
    count(args: {
      where: {
        conversationId: string;
        kind: MessageKind;
        deletedAt: null;
        authorId?: { not: string };
        OR?: KeysetClause<'gt'>;
      };
    }): Promise<number>;
  };
  chatBlock: {
    findMany(args: { where: { OR: ({ blockerId: string } | { blockedId: string })[] } }): Promise<BlockRow[]>;
  };
  chatAvailability: {
    findUnique(args: { where: { userId: string } }): Promise<AvailabilityRow | null>;
    findMany(args: { where: { userId: { in: string[] } } }): Promise<AvailabilityRow[]>;
  };
}

/**
 * The write half. `$transaction` is required rather than optional: every write
 * below touches two tables at least — a message and its conversation's
 * `lastMessageAt` — and a host that cannot give a transaction cannot host this
 * module correctly.
 */
export interface ChatWriteClient extends ChatPrismaClient {
  $transaction<T>(fn: (tx: ChatTransaction) => Promise<T>): Promise<T>;
  chatConversation: ChatPrismaClient['chatConversation'] & {
    create(args: {
      data: {
        title?: string | null;
        icon?: string | null;
        directKey?: string | null;
        createdById: string;
      };
    }): Promise<ConversationRow>;
    update(args: {
      where: { id: string };
      data: { title?: string | null; icon?: string | null; archivedAt?: Date | null; lastMessageAt?: Date };
    }): Promise<ConversationRow>;
  };
  chatParticipant: ChatPrismaClient['chatParticipant'] & {
    create(args: {
      data: { conversationId: string; userId: string; status: ParticipantStatus; invitedById?: string | null };
    }): Promise<ParticipantRow>;
    update(args: {
      where: { conversationId_userId: { conversationId: string; userId: string } };
      data: {
        status?: ParticipantStatus;
        invitedById?: string | null;
        exitedAt?: Date | null;
        lastReadMessageId?: string;
      };
    }): Promise<ParticipantRow>;
  };
  chatMessage: ChatPrismaClient['chatMessage'] & {
    create(args: {
      data: {
        conversationId: string;
        kind: MessageKind;
        authorId: string | null;
        body: string | null;
        clientMessageId?: string | null;
        replyToMessageId?: string | null;
      };
    }): Promise<MessageRow>;
    update(args: {
      where: { id: string };
      data: { body?: string; editedAt?: Date; deletedAt?: Date; deletedById?: string };
    }): Promise<MessageRow>;
    findFirst(args: { where: { conversationId: string; clientMessageId: string } }): Promise<MessageRow | null>;
  };
  chatBlock: ChatPrismaClient['chatBlock'] & {
    create(args: { data: { blockerId: string; blockedId: string } }): Promise<BlockRow>;
    deleteMany(args: { where: { blockerId: string; blockedId: string } }): Promise<{ count: number }>;
  };
  chatAvailability: ChatPrismaClient['chatAvailability'] & {
    /**
     * ⚠ UPSERT, because a person has one answer or none.
     *
     * There is no "create your availability" moment — the first time somebody
     * touches the setting is also the first time a row exists, and a create
     * that raced with itself across two tabs would be a unique-constraint error
     * on a preference change.
     */
    upsert(args: {
      where: { userId: string };
      create: { userId: string; availability: Availability; clearAt: Date | null };
      update: { availability: Availability; clearAt: Date | null };
    }): Promise<AvailabilityRow>;
  };
}

export type ChatTransaction = Omit<ChatWriteClient, '$transaction'>;
