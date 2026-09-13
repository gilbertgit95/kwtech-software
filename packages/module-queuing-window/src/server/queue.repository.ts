import type { TicketStatus } from '../types.js';

/**
 * The slice of a Prisma client this module uses — declared STRUCTURALLY, never
 * imported from a generated one.
 *
 * The module ships `prisma/queue.prisma`; the host composes it into its own
 * schema and hands back the client. So this package has no `@prisma/client`
 * dependency and no opinion about which database the tables are in. The app's
 * `satisfies-modules.ts` proves its client fits, at compile time.
 *
 * Every argument shape here is one the services actually send, and nothing
 * more: a wider interface is a wider promise the fake in the tests would have
 * to keep.
 */

type SortOrder = 'asc' | 'desc';

export interface SettingsRow {
  workspaceId: string;
  organizationId: string;
  enabled: boolean;
  showStaffNames: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LineRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  prefix: string;
  startNumber: number;
  endNumber: number;
  padTo: number;
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WindowRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  nameKey: string;
  sortOrder: number;
  archivedAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WindowLineRow {
  windowId: string;
  lineId: string;
  organizationId: string;
  workspaceId: string;
}

export interface SeatRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  windowId: string;
  userId: string;
  assignedById: string;
  assignedAt: Date;
}

export interface SessionRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  openWorkspaceId: string | null;
  displayCode: string | null;
  failedCodeAttempts: number;
  maxDisplays: number;
  continuedNumbering: boolean;
  startedById: string;
  startedAt: Date;
  stoppedById: string | null;
  stoppedAt: Date | null;
}

export interface DisplayPassRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  sessionId: string;
  tokenHash: string;
  createdAt: Date;
  lastSeenAt: Date | null;
}

export interface SequenceRow {
  lineId: string;
  sessionId: string;
  organizationId: string;
  workspaceId: string;
  lastNumber: number;
  cycle: number;
  updatedAt: Date;
}

export interface TicketRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  lineId: string;
  sessionId: string;
  cycle: number;
  number: number;
  label: string;
  status: TicketStatus;
  windowId: string;
  windowName: string;
  calledById: string;
  firstCalledAt: Date;
  calledAt: Date;
  recallCount: number;
  completedAt: Date | null;
  clientRequestId: string | null;
}

export interface NicknameRow {
  workspaceId: string;
  userId: string;
  organizationId: string;
  nickname: string;
  updatedAt: Date;
}

interface Scoped {
  organizationId: string;
  workspaceId: string;
}

export interface LineUpdate {
  name?: string;
  startNumber?: number;
  endNumber?: number;
  padTo?: number;
  sortOrder?: number;
  archivedAt?: Date | null;
}

export interface WindowUpdate {
  name?: string;
  nameKey?: string;
  sortOrder?: number;
  archivedAt?: Date | null;
}

export interface TicketUpdate {
  status?: TicketStatus;
  completedAt?: Date | null;
  recallCount?: { increment: number };
  calledAt?: Date;
  calledById?: string;
  windowId?: string;
  windowName?: string;
}

export interface QueueTransaction {
  queueSettings: {
    findUnique(args: { where: { workspaceId: string } }): Promise<SettingsRow | null>;
    upsert(args: {
      where: { workspaceId: string };
      create: Scoped & { showStaffNames?: boolean };
      update: { showStaffNames?: boolean };
    }): Promise<SettingsRow>;
  };

  queueLine: {
    findUnique(args: { where: { id: string } }): Promise<LineRow | null>;
    findMany(args: {
      where: { workspaceId: string; archivedAt?: null; id?: { in: string[] } };
      orderBy?: Array<{ sortOrder: SortOrder } | { prefix: SortOrder }>;
    }): Promise<LineRow[]>;
    create(args: {
      data: Scoped & { name: string; prefix: string; startNumber: number; endNumber: number; padTo: number };
    }): Promise<LineRow>;
    update(args: { where: { id: string }; data: LineUpdate }): Promise<LineRow>;
  };

  queueWindow: {
    findUnique(args: { where: { id: string } }): Promise<WindowRow | null>;
    findMany(args: {
      where: { workspaceId: string };
      orderBy?: Array<{ sortOrder: SortOrder } | { name: SortOrder }>;
    }): Promise<WindowRow[]>;
    count(args: { where: { workspaceId: string; archivedAt: null } }): Promise<number>;
    create(args: { data: Scoped & { name: string; nameKey: string; createdById: string } }): Promise<WindowRow>;
    update(args: { where: { id: string }; data: WindowUpdate }): Promise<WindowRow>;
  };

  queueWindowLine: {
    findMany(args: { where: { windowId: string } | { workspaceId: string } }): Promise<WindowLineRow[]>;
    create(args: { data: Scoped & { windowId: string; lineId: string } }): Promise<WindowLineRow>;
    deleteMany(args: { where: { windowId: string } }): Promise<{ count: number }>;
  };

  queueSeat: {
    findUnique(args: {
      where: { workspaceId_userId: { workspaceId: string; userId: string } };
    }): Promise<SeatRow | null>;
    findMany(args: { where: { workspaceId: string } }): Promise<SeatRow[]>;
    create(args: { data: Scoped & { windowId: string; userId: string; assignedById: string } }): Promise<SeatRow>;
    deleteMany(args: {
      where: { windowId: string } | { windowId: string; userId: string } | { workspaceId: string; userId: string };
    }): Promise<{ count: number }>;
  };

  queueSession: {
    findUnique(args: { where: { id: string } | { openWorkspaceId: string } }): Promise<SessionRow | null>;
    findFirst(args: {
      where: { workspaceId: string; stoppedAt: { not: null } };
      orderBy: { startedAt: SortOrder };
    }): Promise<SessionRow | null>;
    create(args: {
      data: Scoped & {
        openWorkspaceId: string;
        displayCode: string;
        maxDisplays: number;
        continuedNumbering: boolean;
        startedById: string;
      };
    }): Promise<SessionRow>;
    updateMany(args: {
      where: { id: string; openWorkspaceId: string };
      data:
        | { openWorkspaceId: null; displayCode: null; stoppedById: string; stoppedAt: Date }
        | { failedCodeAttempts: { increment: number } };
    }): Promise<{ count: number }>;
  };

  queueDisplayPass: {
    count(args: { where: { sessionId: string } }): Promise<number>;
    create(args: { data: Scoped & { sessionId: string; tokenHash: string } }): Promise<DisplayPassRow>;
    deleteMany(args: { where: { sessionId: string } }): Promise<{ count: number }>;
  };

  queueSequence: {
    findUnique(args: {
      where: { lineId_sessionId: { lineId: string; sessionId: string } };
    }): Promise<SequenceRow | null>;
    findMany(args: { where: { sessionId: string } }): Promise<SequenceRow[]>;
    create(args: {
      data: Scoped & { lineId: string; sessionId: string; lastNumber: number; cycle: number };
    }): Promise<SequenceRow>;
    /**
     * ⚠ THE ALLOCATOR'S COMPARE-AND-SET. Matching zero rows means somebody else
     * moved the sequence first; the caller reads again.
     */
    updateMany(args: {
      where: { lineId: string; sessionId: string; lastNumber: number; cycle: number };
      data: { lastNumber: number; cycle: number };
    }): Promise<{ count: number }>;
  };

  queueTicket: {
    findUnique(args: {
      where:
        | { id: string }
        | { sessionId_clientRequestId: { sessionId: string; clientRequestId: string } }
        | { lineId_sessionId_cycle_number: { lineId: string; sessionId: string; cycle: number; number: number } };
    }): Promise<TicketRow | null>;
    findMany(args: {
      where:
        | { sessionId: string; status?: TicketStatus }
        | {
            lineId: string;
            sessionId: string;
            OR: Array<{ cycle: number; number: { gt: number } } | { cycle: number }>;
          };
      orderBy?: { calledAt: SortOrder };
      take?: number;
    }): Promise<TicketRow[]>;
    create(args: {
      data: Scoped & {
        lineId: string;
        sessionId: string;
        cycle: number;
        number: number;
        label: string;
        windowId: string;
        windowName: string;
        calledById: string;
        firstCalledAt: Date;
        calledAt: Date;
        clientRequestId: string | null;
      };
    }): Promise<TicketRow>;
    /** Every status change is CONDITIONAL on the status it was read in. */
    updateMany(args: {
      where:
        | { id: string; status: TicketStatus }
        | { id: string; status: TicketStatus; windowId: string }
        | { sessionId: string; windowId: string; status: TicketStatus };
      data: TicketUpdate;
    }): Promise<{ count: number }>;
  };

  queueStaffNickname: {
    findUnique(args: {
      where: { workspaceId_userId: { workspaceId: string; userId: string } };
    }): Promise<NicknameRow | null>;
    upsert(args: {
      where: { workspaceId_userId: { workspaceId: string; userId: string } };
      create: Scoped & { userId: string; nickname: string };
      update: { nickname: string };
    }): Promise<NicknameRow>;
    deleteMany(args: { where: { workspaceId: string; userId: string } }): Promise<{ count: number }>;
  };
}

/** The read client. The same delegates; a host may bind a replica. */
export type QueuePrismaClient = QueueTransaction;

export interface QueueWriteClient extends QueueTransaction {
  $transaction<T>(fn: (tx: QueueTransaction) => Promise<T>): Promise<T>;
}
