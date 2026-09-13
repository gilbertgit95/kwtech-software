import { Inject, Injectable, Optional } from '@nestjs/common';
import { boardNickname } from '../domain/nicknames.js';
import { isSessionOpen } from '../domain/session.js';
import {
  ALL_QUEUE_EVENTS,
  NULL_QUEUE_PUBSUB,
  type QueueCallEvent,
  type QueueEvent,
  type QueuePubSub,
} from './queue.pubsub.js';
import type { QueuePrismaClient, TicketRow } from './queue.repository.js';
import { QUEUE_PRISMA, QUEUE_PUBSUB } from './queue.tokens.js';
import type { QueueDisplayAdmission } from './queue-display.service.js';

/** How many recent calls a TV lists under Now serving. */
export const BOARD_RECENT_CALLS = 8;

/**
 * How far back the board reads to find each window's latest call. Comfortably
 * more than the windows cap, so a window that called once, long ago in a busy
 * session, is still found.
 */
const BOARD_TICKET_WINDOW = 200;

export interface QueueBoardCall {
  ticketId: string;
  lineId: string;
  label: string;
  windowId: string;
  windowName: string;
  calledAt: string;
  recallCount: number;
  /** Only while the workspace shows names, and only a nickname — never an account name. */
  nickname: string | null;
}

export interface QueueBoard {
  showStaffNames: boolean;
  /** For the TV's own line filter. A presentation filter, not a boundary. */
  lines: Array<{ id: string; prefix: string; name: string }>;
  /** One row per window that has called a number this session — its latest call. */
  serving: QueueBoardCall[];
  recent: QueueBoardCall[];
}

export type QueueDisplayEvent =
  | { kind: 'board'; board: QueueBoard; announce: QueueBoardCall | null }
  | { kind: 'stopped'; board: null; announce: null };

export const DISPLAY_STOPPED: QueueDisplayEvent = { kind: 'stopped', board: null, announce: null };

/**
 * The public board: what a TV shows, and how it stays live.
 *
 * ## Snapshots, not deltas
 *
 * Every event a TV acts on arrives as the WHOLE board, rebuilt from the
 * database, plus — for a call — the one call to chime and announce. A TV that
 * applied deltas would need every one of them in order, and a board that missed
 * one would be wrong until it reloaded: the exact "looks current and is not"
 * failure this screen exists to avoid. A session admits at most
 * `MAX_DISPLAYS_CEILING` displays, so a few queries per display per call is a
 * price worth paying for a board that is right by construction.
 *
 * ## ⚠ The per-publish re-check
 *
 * A subscription is authorised once. The pass that opened this one is only as
 * good as its session, so every snapshot re-reads the session first, and a
 * stopped one ends the stream with `stopped`. The plan had a cache invalidated
 * by the stop event here; the snapshot already reads the database, so the check
 * is one primary-key lookup inside it, and there is no cache to go stale.
 */
@Injectable()
export class QueueBoardService {
  constructor(
    @Inject(QUEUE_PRISMA) private readonly prisma: QueuePrismaClient,
    /** Absent means the board is drawn once and never updates — the stream ends. */
    @Optional() @Inject(QUEUE_PUBSUB) private readonly pubsub?: QueuePubSub,
  ) {}

  /** The board as it stands, or null once the admitting session has stopped. */
  async snapshot(admission: QueueDisplayAdmission): Promise<QueueBoard | null> {
    const session = await this.prisma.queueSession.findUnique({ where: { id: admission.sessionId } });
    if (!session || !isSessionOpen(session) || session.workspaceId !== admission.workspaceId) return null;

    const { workspaceId } = admission;
    const [settings, lines, tickets] = await Promise.all([
      this.prisma.queueSettings.findUnique({ where: { workspaceId } }),
      this.prisma.queueLine.findMany({
        where: { workspaceId, archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { prefix: 'asc' }],
      }),
      this.prisma.queueTicket.findMany({
        where: { sessionId: session.id },
        orderBy: { calledAt: 'desc' },
        take: BOARD_TICKET_WINDOW,
      }),
    ]);

    const latestByWindow = new Map<string, TicketRow>();
    for (const ticket of tickets) if (!latestByWindow.has(ticket.windowId)) latestByWindow.set(ticket.windowId, ticket);
    const serving = [...latestByWindow.values()];
    const recent = tickets.slice(0, BOARD_RECENT_CALLS);

    const showStaffNames = settings?.showStaffNames ?? false;
    const nicknames = new Map<string, string>();
    if (showStaffNames) {
      const callers = [...new Set([...serving, ...recent].map((ticket) => ticket.calledById))];
      const rows = callers.length
        ? await this.prisma.queueStaffNickname.findMany({ where: { workspaceId, userId: { in: callers } } })
        : [];
      for (const row of rows) nicknames.set(row.userId, row.nickname);
    }

    const render = (ticket: TicketRow): QueueBoardCall => ({
      ticketId: ticket.id,
      lineId: ticket.lineId,
      label: ticket.label,
      windowId: ticket.windowId,
      windowName: ticket.windowName,
      calledAt: ticket.calledAt.toISOString(),
      recallCount: ticket.recallCount,
      nickname: boardNickname(showStaffNames, nicknames.get(ticket.calledById)),
    });

    return {
      showStaffNames,
      lines: lines.map((line) => ({ id: line.id, prefix: line.prefix, name: line.name })),
      serving: serving.map(render),
      recent: recent.map(render),
    };
  }

  /**
   * The board, then every change to it, until the session stops.
   *
   * ⚠ PULLS THE LIVE STREAM BEFORE READING THE FIRST SNAPSHOT — the ordering
   * `withCatchUp` in `@kwtech/module-kit` documents — so a call made while the
   * snapshot is read is queued rather than lost. The overlap costs at most one
   * redundant snapshot, which a board shows identically.
   */
  async *stream(admission: QueueDisplayAdmission): AsyncIterableIterator<QueueDisplayEvent> {
    const live = (this.pubsub ?? NULL_QUEUE_PUBSUB).asyncIterableIterator<QueueEvent>(ALL_QUEUE_EVENTS);
    const firstPull = live.next();

    try {
      const initial = await this.snapshot(admission);
      if (!initial) {
        yield DISPLAY_STOPPED;
        return;
      }
      yield { kind: 'board', board: initial, announce: null };

      let result = await firstPull;
      while (!result.done) {
        const event = result.value;
        if (event.workspaceId === admission.workspaceId) {
          if (event.kind === 'session' && event.sessionId === admission.sessionId && event.change === 'stopped') {
            yield DISPLAY_STOPPED;
            return;
          }
          if (redrawsBoard(event, admission.sessionId)) {
            const board = await this.snapshot(admission);
            if (!board) {
              yield DISPLAY_STOPPED;
              return;
            }
            yield { kind: 'board', board, announce: announcement(event, board) };
          }
        }
        result = await live.next();
      }
    } finally {
      await live.return?.();
    }
  }
}

/**
 * Whether an event changes what a TV shows.
 *
 * Done and No-show do not: the board shows each window's latest CALL, and a
 * customer being served is not news in a waiting room. Seats do not either —
 * the board never names a seat, only who called.
 */
function redrawsBoard(event: QueueEvent, sessionId: string): boolean {
  switch (event.kind) {
    case 'call':
      return event.sessionId === sessionId && (event.change === 'called' || event.change === 'recalled');
    case 'workspace':
      return event.change !== 'seats';
    case 'session':
      return false;
  }
}

/** The call to chime for: the event's ticket, as the board now renders it. */
function announcement(event: QueueEvent, board: QueueBoard): QueueBoardCall | null {
  if (event.kind !== 'call') return null;
  const call: QueueCallEvent = event;
  return (
    board.serving.find((row) => row.ticketId === call.ticket.id) ??
    board.recent.find((row) => row.ticketId === call.ticket.id) ?? {
      ticketId: call.ticket.id,
      lineId: call.ticket.lineId,
      label: call.ticket.label,
      windowId: call.ticket.windowId,
      windowName: call.ticket.windowName,
      calledAt: call.ticket.calledAt,
      recallCount: call.ticket.recallCount,
      nickname: null,
    }
  );
}
