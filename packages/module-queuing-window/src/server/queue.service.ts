import { Inject, Injectable, Optional } from '@nestjs/common';
import { formatDisplayCode, MAX_FAILED_CODE_ATTEMPTS } from '../domain/session.js';
import type { QueueStaffCheck, QueueStaffDirectory, QueueStaffMember } from './ports.js';
import type {
  LineRow,
  QueuePrismaClient,
  SeatRow,
  SessionRow,
  SettingsRow,
  TicketRow,
  WindowRow,
} from './queue.repository.js';
import { QUEUE_PRISMA, QUEUE_STAFF_CHECK, QUEUE_STAFF_DIRECTORY } from './queue.tokens.js';

/** How many recent calls the console lists. */
export const RECENT_CALLS = 20;

export interface QueueScope {
  organizationId: string;
  workspaceId: string;
}

export interface QueueConsoleView {
  settings: Pick<SettingsRow, 'enabled' | 'showStaffNames'>;
  /** The OPEN session, or null. ⚠ Never carries the code — see `displayCode`. */
  session: SessionRow | null;
  lines: LineRow[];
  windows: Array<WindowRow & { lineIds: string[] }>;
  seats: Array<
    SeatRow & {
      displayName: string;
      /** Null when the app bound no `QueueStaffCheck`. */
      canServe: boolean | null;
    }
  >;
  myWindowId: string | null;
  myNickname: string | null;
  /** The ticket each window is serving right now: its latest still-called one. */
  serving: TicketRow[];
  recent: TicketRow[];
}

export interface QueueDisplayCodeView {
  /** Formatted for reading aloud: `K7QM-4XHT`. */
  code: string;
  activeDisplays: number;
  maxDisplays: number;
  failedCodeAttempts: number;
  locked: boolean;
}

/** What a seat shows when the host bound no directory. */
export const UNNAMED_MEMBER = 'A member';

/**
 * Reading the queue. Every method is scoped by workspace, and the guard upstream
 * has already required `queue:read` (or `queue:start`, for the code) in it.
 */
@Injectable()
export class QueueService {
  constructor(
    @Inject(QUEUE_PRISMA) private readonly prisma: QueuePrismaClient,
    @Optional() @Inject(QUEUE_STAFF_DIRECTORY) private readonly directory?: QueueStaffDirectory,
    @Optional() @Inject(QUEUE_STAFF_CHECK) private readonly staff?: QueueStaffCheck,
  ) {}

  /**
   * Everything the console draws, in a constant number of queries plus one
   * staff check per seat.
   *
   * ⚠ The per-seat check is how the console flags a window that LOOKS staffed by
   * somebody who can no longer serve (§12.62, at full strength since seats
   * persist). It is bounded by the `queue:windows` cap and runs when the console
   * loads, never per event.
   */
  async console(scope: QueueScope, actorId: string): Promise<QueueConsoleView> {
    const { organizationId, workspaceId } = scope;
    const [settings, session, lines, windows, windowLines, seats, nickname] = await Promise.all([
      this.prisma.queueSettings.findUnique({ where: { workspaceId } }),
      this.prisma.queueSession.findUnique({ where: { openWorkspaceId: workspaceId } }),
      this.prisma.queueLine.findMany({ where: { workspaceId }, orderBy: [{ sortOrder: 'asc' }, { prefix: 'asc' }] }),
      this.prisma.queueWindow.findMany({ where: { workspaceId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.queueWindowLine.findMany({ where: { workspaceId } }),
      this.prisma.queueSeat.findMany({ where: { workspaceId } }),
      this.prisma.queueStaffNickname.findUnique({ where: { workspaceId_userId: { workspaceId, userId: actorId } } }),
    ]);

    const [called, recent] = session
      ? await Promise.all([
          this.prisma.queueTicket.findMany({
            where: { sessionId: session.id, status: 'called' },
            orderBy: { calledAt: 'desc' },
          }),
          this.prisma.queueTicket.findMany({
            where: { sessionId: session.id },
            orderBy: { calledAt: 'desc' },
            take: RECENT_CALLS,
          }),
        ])
      : [[], []];

    // Newest first, so the first ticket seen for a window is the one it is serving.
    const serving = new Map<string, TicketRow>();
    for (const ticket of called) if (!serving.has(ticket.windowId)) serving.set(ticket.windowId, ticket);

    const names = new Map(
      (await this.describe(seats.map((seat) => seat.userId))).map((p) => [p.userId, p.displayName]),
    );
    const staff = this.staff;
    const canServe = await Promise.all(
      seats.map((seat) => (staff ? staff.canServe(organizationId, workspaceId, seat.userId) : Promise.resolve(null))),
    );

    return {
      settings: { enabled: settings?.enabled ?? true, showStaffNames: settings?.showStaffNames ?? false },
      session,
      lines,
      windows: windows.map((window) => ({
        ...window,
        lineIds: windowLines.filter((link) => link.windowId === window.id).map((link) => link.lineId),
      })),
      seats: seats.map((seat, index) => ({
        ...seat,
        displayName: names.get(seat.userId) ?? UNNAMED_MEMBER,
        canServe: canServe[index] ?? null,
      })),
      myWindowId: seats.find((seat) => seat.userId === actorId)?.windowId ?? null,
      myNickname: nickname?.nickname ?? null,
      serving: [...serving.values()],
      recent,
    };
  }

  /**
   * The open session's code, for the console's code panel — bound to
   * `queue:start`, because the people who can authorise a display are the people
   * who can see what authorises it.
   */
  async displayCode(scope: QueueScope): Promise<QueueDisplayCodeView | null> {
    const session = await this.prisma.queueSession.findUnique({ where: { openWorkspaceId: scope.workspaceId } });
    if (!session?.displayCode) return null;

    const activeDisplays = await this.prisma.queueDisplayPass.count({ where: { sessionId: session.id } });
    return {
      code: formatDisplayCode(session.displayCode),
      activeDisplays,
      maxDisplays: session.maxDisplays,
      failedCodeAttempts: session.failedCodeAttempts,
      locked: session.failedCodeAttempts >= MAX_FAILED_CODE_ATTEMPTS,
    };
  }

  /** Who a window can be assigned to. Empty when the host bound no directory. */
  async staffCandidates(scope: QueueScope): Promise<readonly QueueStaffMember[]> {
    return this.directory ? this.directory.listServers(scope.organizationId, scope.workspaceId) : [];
  }

  async windowLineIds(windowId: string): Promise<string[]> {
    return (await this.prisma.queueWindowLine.findMany({ where: { windowId } })).map((link) => link.lineId);
  }

  private async describe(userIds: readonly string[]): Promise<readonly QueueStaffMember[]> {
    if (!this.directory || userIds.length === 0) return [];
    return this.directory.describe([...new Set(userIds)]);
  }
}
