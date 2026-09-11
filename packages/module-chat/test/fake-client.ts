import type {
  BlockRow,
  ChatWriteClient,
  ConversationRow,
  MessageRow,
  ParticipantRow,
} from '../src/server/chat.repository.js';
import type { ParticipantStatus } from '../src/types.js';

/**
 * An in-memory stand-in for the host's Prisma client.
 *
 * This is the payoff of `ChatPrismaClient` being a STRUCTURAL interface: the
 * module opens no connection, so its own tests need no database. A fake that
 * satisfies the interface is as real as the client, and the compiler says so.
 *
 * ⚠ The fake generates `createdAt` ITSELF, exactly as the database does, and
 * increments so ordering is deterministic. A fake that let the caller pass one
 * would let a test pass that the database would fail.
 */
export interface FakeState {
  conversations: ConversationRow[];
  participants: ParticipantRow[];
  messages: MessageRow[];
  blocks: BlockRow[];
}

export function emptyState(): FakeState {
  return { conversations: [], participants: [], messages: [], blocks: [] };
}

export function fakeClient(state: FakeState = emptyState()) {
  let sequence = 0;
  const now = () => new Date(Date.UTC(2026, 8, 11, 12, 0, sequence++));
  const nextId = (prefix: string) => `${prefix}${sequence++}`;

  const participantKey = (conversationId: string, userId: string) => `${conversationId}::${userId}`;
  const findParticipant = (conversationId: string, userId: string) =>
    state.participants.find(
      (row) => participantKey(row.conversationId, row.userId) === participantKey(conversationId, userId),
    ) ?? null;

  const statusMatches = (status: ParticipantStatus, filter?: ParticipantStatus | { in: ParticipantStatus[] }) => {
    if (filter === undefined) return true;
    return typeof filter === 'string' ? status === filter : filter.in.includes(status);
  };

  const client = {
    async $transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      // No rollback: these tests assert the decisions, not the isolation. A fake
      // that pretended to roll back would be claiming something it cannot do.
      return fn(client as never);
    },

    chatConversation: {
      async findUnique(args: { where: { id: string } | { directKey: string } }) {
        const where = args.where;
        if ('id' in where) return state.conversations.find((row) => row.id === where.id) ?? null;
        return state.conversations.find((row) => row.directKey === where.directKey) ?? null;
      },
      async findMany(args: { where: { id: { in: string[] } } }) {
        return state.conversations
          .filter((row) => args.where.id.in.includes(row.id))
          .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
      },
      async count(args: {
        where: {
          createdById: string;
          archivedAt: null;
          directKey: null;
          participants: { some: { userId: string; status: ParticipantStatus } };
        };
      }) {
        return state.conversations.filter((row) => {
          if (row.createdById !== args.where.createdById) return false;
          if (row.archivedAt !== null) return false;
          if (row.directKey !== null) return false;
          const me = findParticipant(row.id, args.where.participants.some.userId);
          return me?.status === args.where.participants.some.status;
        }).length;
      },
      async create(args: { data: Partial<ConversationRow> & { createdById: string } }) {
        const row: ConversationRow = {
          id: nextId('conv-'),
          title: args.data.title ?? null,
          icon: args.data.icon ?? null,
          directKey: args.data.directKey ?? null,
          createdById: args.data.createdById,
          archivedAt: null,
          lastMessageAt: null,
          createdAt: now(),
        };
        state.conversations.push(row);
        return row;
      },
      async update(args: { where: { id: string }; data: Partial<ConversationRow> }) {
        const row = state.conversations.find((one) => one.id === args.where.id);
        if (!row) throw new Error(`no conversation ${args.where.id}`);
        Object.assign(row, args.data);
        return row;
      },
    },

    chatParticipant: {
      async findUnique(args: { where: { conversationId_userId: { conversationId: string; userId: string } } }) {
        const { conversationId, userId } = args.where.conversationId_userId;
        return findParticipant(conversationId, userId);
      },
      async findMany(args: {
        where: {
          userId?: string;
          conversationId?: string | { in: string[] };
          status?: ParticipantStatus | { in: ParticipantStatus[] };
        };
      }) {
        return state.participants.filter((row) => {
          if (args.where.userId !== undefined && row.userId !== args.where.userId) return false;
          if (typeof args.where.conversationId === 'string' && row.conversationId !== args.where.conversationId) {
            return false;
          }
          if (
            args.where.conversationId &&
            typeof args.where.conversationId === 'object' &&
            !args.where.conversationId.in.includes(row.conversationId)
          ) {
            return false;
          }
          return statusMatches(row.status, args.where.status);
        });
      },
      async count(args: { where: { userId: string; status: ParticipantStatus } }) {
        return state.participants.filter((row) => row.userId === args.where.userId && row.status === args.where.status)
          .length;
      },
      async create(args: {
        data: { conversationId: string; userId: string; status: ParticipantStatus; invitedById?: string | null };
      }) {
        const row: ParticipantRow = {
          id: nextId('part-'),
          conversationId: args.data.conversationId,
          userId: args.data.userId,
          status: args.data.status,
          invitedById: args.data.invitedById ?? null,
          lastReadMessageId: null,
          mutedUntil: null,
          joinedAt: now(),
          exitedAt: null,
        };
        state.participants.push(row);
        return row;
      },
      async update(args: {
        where: { conversationId_userId: { conversationId: string; userId: string } };
        data: Partial<ParticipantRow>;
      }) {
        const { conversationId, userId } = args.where.conversationId_userId;
        const row = findParticipant(conversationId, userId);
        if (!row) throw new Error('no participant');
        Object.assign(row, args.data);
        return row;
      },
    },

    chatMessage: {
      async findUnique(args: { where: { id: string } }) {
        return state.messages.find((row) => row.id === args.where.id) ?? null;
      },
      async findFirst(args: { where: { conversationId: string; clientMessageId: string } }) {
        return (
          state.messages.find(
            (row) =>
              row.conversationId === args.where.conversationId && row.clientMessageId === args.where.clientMessageId,
          ) ?? null
        );
      },
      async findMany(args: { where: { conversationId: string | { in: string[] } }; take?: number }) {
        const id = typeof args.where.conversationId === 'string' ? args.where.conversationId : null;
        return state.messages
          .filter((row) => (id ? row.conversationId === id : true))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, args.take ?? undefined);
      },
      async count(args: { where: { conversationId: string; authorId?: { not: string } } }) {
        return state.messages.filter(
          (row) =>
            row.conversationId === args.where.conversationId &&
            row.kind === 'user' &&
            row.deletedAt === null &&
            (args.where.authorId ? row.authorId !== args.where.authorId.not : true),
        ).length;
      },
      async create(args: {
        data: {
          conversationId: string;
          kind: 'user' | 'system';
          authorId: string | null;
          body: string | null;
          clientMessageId?: string | null;
          replyToMessageId?: string | null;
        };
      }) {
        const row: MessageRow = {
          id: nextId('msg-'),
          conversationId: args.data.conversationId,
          kind: args.data.kind,
          authorId: args.data.authorId,
          body: args.data.body,
          clientMessageId: args.data.clientMessageId ?? null,
          replyToMessageId: args.data.replyToMessageId ?? null,
          // ⚠ Generated here, as the database generates it.
          createdAt: now(),
          editedAt: null,
          deletedAt: null,
          deletedById: null,
        };
        state.messages.push(row);
        return row;
      },
      async update(args: { where: { id: string }; data: Partial<MessageRow> }) {
        const row = state.messages.find((one) => one.id === args.where.id);
        if (!row) throw new Error('no message');
        Object.assign(row, args.data);
        return row;
      },
    },

    chatBlock: {
      async findMany() {
        return state.blocks;
      },
      async create(args: { data: { blockerId: string; blockedId: string } }) {
        const row: BlockRow = { ...args.data, createdAt: now() };
        state.blocks.push(row);
        return row;
      },
      async deleteMany(args: { where: { blockerId: string; blockedId: string } }) {
        const before = state.blocks.length;
        state.blocks = state.blocks.filter(
          (row) => !(row.blockerId === args.where.blockerId && row.blockedId === args.where.blockedId),
        );
        return { count: before - state.blocks.length };
      },
    },
  } as unknown as ChatWriteClient;

  return { client, state };
}
