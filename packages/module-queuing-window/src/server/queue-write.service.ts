import { randomBytes } from 'node:crypto';
import { type LimitChecker, NULL_LIMIT_CHECKER } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { checkLineShape, formatTicketLabel, prepareLineName, preparePrefix } from '../domain/lines.js';
import { prepareNickname } from '../domain/nicknames.js';
import {
  checkNumberInLine,
  freshPosition,
  nextToCall,
  positionForNextNumber,
  startingPosition,
} from '../domain/numbering.js';
import { planAssignment } from '../domain/seats.js';
import { checkCallingAllowed, checkCanStart, generateDisplayCode, stoppedSessionFields } from '../domain/session.js';
import type { DisplayTextRefusal } from '../domain/text.js';
import { checkTicketAct, nextTicketStatus, planCallNumber } from '../domain/tickets.js';
import { prepareWindowName, windowNameKey, windowServesLine } from '../domain/windows.js';
import { QUEUE_LIMIT } from '../feature-keys.js';
import type { TicketStatus } from '../types.js';
import type { QueueStaffCheck } from './ports.js';
import { isUniqueViolation, NO_WINDOW_MESSAGE, NOT_STARTED_MESSAGE, QueueWriteError } from './queue.errors.js';
import { QueueEventPublisher } from './queue.events.js';
import type { QueueCallChange } from './queue.pubsub.js';
import type {
  LineRow,
  LineUpdate,
  QueueTransaction,
  QueueWriteClient,
  SeatRow,
  SequenceRow,
  SessionRow,
  SettingsRow,
  TicketRow,
  WindowRow,
  WindowUpdate,
} from './queue.repository.js';
import type { QueueScope } from './queue.service.js';
import { QUEUE_LIMIT_CHECKER, QUEUE_PRISMA_WRITE, QUEUE_STAFF_CHECK } from './queue.tokens.js';

/**
 * The most displays one session admits, whatever a plan says — including a plan
 * that says "unlimited". A TV admitted by a code on a public wall is a socket
 * this server holds open, and "unlimited" there is a resource handed to anybody
 * who photographs the code.
 */
export const MAX_DISPLAYS_CEILING = 50;

/** How many times a call retries after losing a race, before saying so. */
export const MAX_ALLOCATION_ATTEMPTS = 5;

/** A client request id is a UUID; anything much longer is not one. */
const MAX_CLIENT_REQUEST_ID = 64;

/** Thrown inside a transaction to roll it back and try again. Never escapes. */
class AllocationConflict extends Error {}

/** A call, and what to announce about it — null when nothing new happened. */
interface CallOutcome {
  ticket: TicketRow;
  change: QueueCallChange | null;
}

const TEXT_REFUSAL: Record<DisplayTextRefusal, string> = {
  empty: 'cannot be empty',
  too_long: 'is too long',
  invisible_characters: 'contains characters that cannot be shown on a display',
};

function refuseText(what: string, reason: DisplayTextRefusal): QueueWriteError {
  return new QueueWriteError('invalid', `The ${what} ${TEXT_REFUSAL[reason]}`, { field: what, reason });
}

const scoped = (scope: QueueScope) => ({ organizationId: scope.organizationId, workspaceId: scope.workspaceId });

/**
 * Every write the queue makes.
 *
 * ⚠ The GUARD has answered "may this person do this kind of thing in this
 * workspace". Every method here answers the other half against the rows,
 * inside its own transaction: is queuing running, which window is this person
 * assigned, does that window serve that line, is that ticket theirs to touch.
 *
 * ⚠ Every row a caller names by id is checked against the workspace in the
 * URL. An id from another workspace is "not found", never somebody else's row.
 *
 * ## And every write announces itself, AFTER it has committed
 *
 * ⚠ The publish is always outside the transaction, which is why several methods
 * assign the result and announce on the next line rather than returning the
 * `$transaction` call. Announcing from inside would chime a TV for a call the
 * allocator's own retry then rolled back. See `QueueEventPublisher`.
 */
@Injectable()
export class QueueWriteService {
  constructor(
    @Inject(QUEUE_PRISMA_WRITE) private readonly prisma: QueueWriteClient,
    /** Absent means no cap on windows, and `MAX_DISPLAYS_CEILING` displays. */
    @Optional() @Inject(QUEUE_LIMIT_CHECKER) private readonly limits?: LimitChecker,
    /** Absent means you may assign a window only to yourself. */
    @Optional() @Inject(QUEUE_STAFF_CHECK) private readonly staff?: QueueStaffCheck,
    /** Absent means nothing is announced and every write still happens — the shape a worker gets. */
    @Optional() private readonly events?: QueueEventPublisher,
  ) {}

  private get checker(): LimitChecker {
    return this.limits ?? NULL_LIMIT_CHECKER;
  }

  // ── sessions ──────────────────────────────────────────────────────────────

  /**
   * Start queuing: open a session, generate its display code, and set every
   * line's starting number.
   *
   * ⚠ `maxDisplays` IS RESOLVED HERE, from the starter's plan, and stored on the
   * session. The code exchange later has no actor to ask about.
   *
   * ⚠ Two supervisors pressing Start at once get ONE session: the loser's
   * insert violates `openWorkspaceId`'s unique constraint and is refused as
   * already running.
   */
  async startQueue(scope: QueueScope, actorId: string, input: { continueNumbering: boolean }): Promise<SessionRow> {
    const open = await this.prisma.queueSession.findUnique({ where: { openWorkspaceId: scope.workspaceId } });
    if (checkCanStart(open)) throw new QueueWriteError('already_running', 'Queuing is already running');

    const decision = await this.checker.check({
      actorId,
      key: QUEUE_LIMIT.displays,
      current: 0,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
    });
    const maxDisplays =
      decision.limit === null ? MAX_DISPLAYS_CEILING : Math.max(1, Math.min(decision.limit, MAX_DISPLAYS_CEILING));

    let session: SessionRow;
    try {
      session = await this.prisma.$transaction(async (tx) => {
        const previous = input.continueNumbering
          ? await tx.queueSession.findFirst({
              where: { workspaceId: scope.workspaceId, stoppedAt: { not: null } },
              orderBy: { startedAt: 'desc' },
            })
          : null;
        const carried = previous ? await tx.queueSequence.findMany({ where: { sessionId: previous.id } }) : [];

        const created = await tx.queueSession.create({
          data: {
            ...scoped(scope),
            openWorkspaceId: scope.workspaceId,
            displayCode: generateDisplayCode(randomBytes),
            maxDisplays,
            continuedNumbering: input.continueNumbering,
            startedById: actorId,
          },
        });

        const lines = await tx.queueLine.findMany({ where: { workspaceId: scope.workspaceId, archivedAt: null } });
        for (const line of lines) {
          const last = carried.find((sequence) => sequence.lineId === line.id);
          await tx.queueSequence.create({
            data: {
              ...scoped(scope),
              lineId: line.id,
              sessionId: created.id,
              ...startingPosition(line, last, input.continueNumbering),
            },
          });
        }

        await tx.queueSettings.upsert({ where: { workspaceId: scope.workspaceId }, create: scoped(scope), update: {} });
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new QueueWriteError('already_running', 'Queuing is already running');
      throw error;
    }

    await this.events?.sessionChanged(session, 'started');
    return session;
  }

  /**
   * Stop queuing. The code is cleared, every display pass is deleted, and the
   * workspace is free for the next Start.
   *
   * ⚠ SEATS ARE NOT TOUCHED. They persist across sessions, so the next Start
   * opens with the same people at the same windows.
   *
   * ⚠ The announcement is what takes every TV dark at once. A TV that misses it
   * finds out at its next reconnect, when the handshake refuses its pass.
   */
  async stopQueue(scope: QueueScope, actorId: string): Promise<SessionRow> {
    const session = await this.prisma.$transaction(async (tx) => {
      const open = await tx.queueSession.findUnique({ where: { openWorkspaceId: scope.workspaceId } });
      if (!open) throw new QueueWriteError('not_started', 'Queuing is not running');

      const stopped = await tx.queueSession.updateMany({
        where: { id: open.id, openWorkspaceId: scope.workspaceId },
        data: stoppedSessionFields(actorId, new Date()),
      });
      if (stopped.count === 0) throw new QueueWriteError('not_started', 'Queuing is not running');

      await tx.queueDisplayPass.deleteMany({ where: { sessionId: open.id } });
      const row = await tx.queueSession.findUnique({ where: { id: open.id } });
      if (!row) throw new QueueWriteError('not_found', 'That session no longer exists');
      return row;
    });

    await this.events?.sessionChanged(session, 'stopped');
    return session;
  }

  /**
   * Whether public displays show staff nicknames.
   *
   * ⚠ Reaches every TV at once: somebody who asks to be taken off the board must
   * not have to wait until tomorrow.
   */
  async setShowStaffNames(scope: QueueScope, show: boolean): Promise<SettingsRow> {
    const settings = await this.prisma.queueSettings.upsert({
      where: { workspaceId: scope.workspaceId },
      create: { ...scoped(scope), showStaffNames: show },
      update: { showStaffNames: show },
    });
    await this.events?.workspaceChanged(scope, 'settings');
    return settings;
  }

  // ── calling ───────────────────────────────────────────────────────────────

  /**
   * Call next: allocate the next number in a line and call it to the actor's
   * window.
   *
   * ⚠ A CONDITIONAL UPDATE, NEVER READ-THEN-WRITE. The sequence moves from the
   * position it was read at to the next one in one statement; matching nothing
   * means somebody else called first, and the whole transaction runs again. The
   * ticket's unique `(lineId, sessionId, cycle, number)` is the backstop.
   *
   * ⚠ IDEMPOTENT ON `clientRequestId`. A double-tap or a retry over flaky
   * counter Wi-Fi would otherwise skip a number, and the customer holding it
   * would never be called. A replay announces NOTHING — a TV that chimed twice
   * for one call sends two people looking.
   *
   * ⚠ CALLING A NEW NUMBER COMPLETES THE ONE THE WINDOW WAS SERVING. A window
   * serves one customer at a time. Without this, a ticket nobody marked Done
   * stays "called" at that window for the rest of the session — and Call
   * number… from any other window is refused for it as "being served".
   */
  async callNext(
    scope: QueueScope,
    actorId: string,
    input: { lineId: string; clientRequestId?: string | null | undefined },
  ): Promise<TicketRow> {
    const clientRequestId = input.clientRequestId?.trim() || null;
    if (clientRequestId && clientRequestId.length > MAX_CLIENT_REQUEST_ID) {
      throw new QueueWriteError('invalid', 'That request id is not valid');
    }

    const outcome = await this.withRetry<CallOutcome>(async (tx) => {
      const { session, window, line } = await this.servingContext(tx, scope, actorId, input.lineId);

      if (clientRequestId) {
        const existing = await tx.queueTicket.findUnique({
          where: { sessionId_clientRequestId: { sessionId: session.id, clientRequestId } },
        });
        if (existing) return { ticket: existing, change: null };
      }

      const sequence = await this.sequenceFor(tx, scope, session.id, line);
      // Only what can be skipped: numbers ahead in this cycle, and the next cycle.
      const ahead = await tx.queueTicket.findMany({
        where: {
          lineId: line.id,
          sessionId: session.id,
          OR: [{ cycle: sequence.cycle, number: { gt: sequence.lastNumber } }, { cycle: sequence.cycle + 1 }],
        },
      });
      const called = new Set(ahead.map((ticket) => `${ticket.cycle}:${ticket.number}`));
      const next = nextToCall(sequence, line, (cycle, number) => called.has(`${cycle}:${number}`));
      if (!next) {
        throw new QueueWriteError('conflict', "Every number in this line has been called. Set the line's next number.");
      }

      const moved = await tx.queueSequence.updateMany({
        where: { lineId: line.id, sessionId: session.id, lastNumber: sequence.lastNumber, cycle: sequence.cycle },
        data: { lastNumber: next.lastNumber, cycle: next.cycle },
      });
      if (moved.count === 0) throw new AllocationConflict();

      const now = new Date();
      await this.completeServing(tx, session.id, window.id, now);
      const ticket = await tx.queueTicket.create({
        data: {
          ...scoped(scope),
          lineId: line.id,
          sessionId: session.id,
          cycle: next.cycle,
          number: next.lastNumber,
          label: formatTicketLabel(line.prefix, next.lastNumber, line.padTo),
          windowId: window.id,
          windowName: window.name,
          calledById: actorId,
          firstCalledAt: now,
          calledAt: now,
          clientRequestId,
        },
      });
      return { ticket, change: 'called' };
    });

    return this.announce(outcome);
  }

  /**
   * Call number…: any number, ahead or behind.
   *
   * A number nobody has called in this cycle is created. One already called is
   * never a second row — see `planCallNumber`.
   */
  async callNumber(scope: QueueScope, actorId: string, input: { lineId: string; number: number }): Promise<TicketRow> {
    const outcome = await this.withRetry<CallOutcome>(async (tx) => {
      const { session, window, line } = await this.servingContext(tx, scope, actorId, input.lineId);
      if (checkNumberInLine(input.number, line)) {
        throw new QueueWriteError('invalid', `${line.prefix} runs from ${line.startNumber} to ${line.endNumber}`);
      }

      const sequence = await tx.queueSequence.findUnique({
        where: { lineId_sessionId: { lineId: line.id, sessionId: session.id } },
      });
      const cycle = sequence?.cycle ?? 0;
      const existing = await tx.queueTicket.findUnique({
        where: {
          lineId_sessionId_cycle_number: { lineId: line.id, sessionId: session.id, cycle, number: input.number },
        },
      });

      const plan = planCallNumber(existing, window.id);
      const now = new Date();
      switch (plan.kind) {
        case 'refused':
          throw new QueueWriteError(
            'invalid',
            plan.reason === 'already_served'
              ? 'That number has already been served'
              : 'That number is being served at another window',
            { reason: plan.reason },
          );
        case 'recall': {
          const changed = await tx.queueTicket.updateMany({
            where: { id: plan.ticketId, status: 'called', windowId: window.id },
            data: { recallCount: { increment: 1 }, calledAt: now },
          });
          if (changed.count === 0) throw new AllocationConflict();
          return { ticket: await this.ticketById(tx, plan.ticketId), change: 'recalled' };
        }
        case 'call_again': {
          await this.completeServing(tx, session.id, window.id, now);
          const changed = await tx.queueTicket.updateMany({
            where: { id: plan.ticketId, status: 'no_show' },
            data: {
              status: 'called',
              completedAt: null,
              calledAt: now,
              calledById: actorId,
              windowId: window.id,
              windowName: window.name,
            },
          });
          if (changed.count === 0) throw new AllocationConflict();
          return { ticket: await this.ticketById(tx, plan.ticketId), change: 'called' };
        }
        case 'create': {
          await this.completeServing(tx, session.id, window.id, now);
          const ticket = await tx.queueTicket.create({
            data: {
              ...scoped(scope),
              lineId: line.id,
              sessionId: session.id,
              cycle,
              number: input.number,
              label: formatTicketLabel(line.prefix, input.number, line.padTo),
              windowId: window.id,
              windowName: window.name,
              calledById: actorId,
              firstCalledAt: now,
              calledAt: now,
              clientRequestId: null,
            },
          });
          return { ticket, change: 'called' };
        }
      }
    });

    return this.announce(outcome);
  }

  /**
   * Recall, Done or No-show, on a ticket at the actor's own window.
   *
   * Conditional on the status it was read in, so two taps of Done do not
   * complete a ticket twice and a Recall cannot land on a ticket somebody just
   * marked a no-show.
   */
  async actOnTicket(
    scope: QueueScope,
    actorId: string,
    ticketId: string,
    transition: 'recall' | 'done' | 'no_show',
  ): Promise<TicketRow> {
    const ticket = await this.prisma.$transaction(async (tx) => {
      const current = await tx.queueTicket.findUnique({ where: { id: ticketId } });
      if (!current || current.workspaceId !== scope.workspaceId) {
        throw new QueueWriteError('not_found', 'That number no longer exists');
      }

      const seat = await tx.queueSeat.findUnique({
        where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId: actorId } },
      });
      switch (checkTicketAct(current, transition, seat?.windowId)) {
        case 'no_window':
          throw new QueueWriteError('no_window', NO_WINDOW_MESSAGE);
        case 'not_your_window':
          throw new QueueWriteError('not_permitted', 'That number was called to another window');
        case 'not_available':
          throw new QueueWriteError(
            'invalid',
            `That number is already ${current.status === 'done' ? 'done' : 'a no-show'}`,
          );
        case null:
          break;
      }

      if (transition === 'recall') {
        const session = await tx.queueSession.findUnique({ where: { openWorkspaceId: scope.workspaceId } });
        if (checkCallingAllowed(session) || session?.id !== current.sessionId) {
          throw new QueueWriteError('not_started', NOT_STARTED_MESSAGE);
        }
      }

      const now = new Date();
      const next = nextTicketStatus(current.status, transition) as TicketStatus;
      const changed = await tx.queueTicket.updateMany({
        where: { id: current.id, status: current.status },
        data:
          transition === 'recall'
            ? { recallCount: { increment: 1 }, calledAt: now }
            : { status: next, completedAt: now },
      });
      if (changed.count === 0) throw new QueueWriteError('conflict', 'That number changed while you were acting on it');

      return this.ticketById(tx, current.id);
    });

    return this.announce({ ticket, change: transition === 'recall' ? 'recalled' : transition });
  }

  // ── lines ─────────────────────────────────────────────────────────────────

  async createLine(
    scope: QueueScope,
    input: {
      name: string;
      prefix: string;
      startNumber?: number | null | undefined;
      endNumber?: number | null | undefined;
      padTo?: number | null | undefined;
    },
  ): Promise<LineRow> {
    const name = prepareLineName(input.name);
    if ('refused' in name) throw refuseText('line name', name.refused);
    const prefix = preparePrefix(input.prefix);
    if ('refused' in prefix) {
      throw new QueueWriteError('invalid', 'A prefix is one to three letters or digits', { reason: prefix.refused });
    }

    const shape = { startNumber: input.startNumber ?? 1, endNumber: input.endNumber ?? 999, padTo: input.padTo ?? 3 };
    const refused = checkLineShape(shape);
    if (refused) throw new QueueWriteError('invalid', lineShapeMessage(refused), { reason: refused });

    let line: LineRow;
    try {
      line = await this.prisma.queueLine.create({
        data: { ...scoped(scope), name: name.text, prefix: prefix.prefix, ...shape },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new QueueWriteError('prefix_taken', `A line already uses the prefix ${prefix.prefix}`);
      }
      throw error;
    }
    await this.events?.workspaceChanged(scope, 'lines');
    return line;
  }

  /**
   * ⚠ THE PREFIX IS NOT EDITABLE. It is the line's identity on every slip in
   * people's hands and every ticket's label; changing it is a new line.
   */
  async updateLine(
    scope: QueueScope,
    input: {
      lineId: string;
      name?: string | null | undefined;
      startNumber?: number | null | undefined;
      endNumber?: number | null | undefined;
      padTo?: number | null | undefined;
      sortOrder?: number | null | undefined;
    },
  ): Promise<LineRow> {
    const line = await this.lineIn(this.prisma, scope, input.lineId);
    const data: LineUpdate = {};

    if (input.name != null) {
      const name = prepareLineName(input.name);
      if ('refused' in name) throw refuseText('line name', name.refused);
      data.name = name.text;
    }

    const shape = {
      startNumber: input.startNumber ?? line.startNumber,
      endNumber: input.endNumber ?? line.endNumber,
      padTo: input.padTo ?? line.padTo,
    };
    const refused = checkLineShape(shape);
    if (refused) throw new QueueWriteError('invalid', lineShapeMessage(refused), { reason: refused });
    Object.assign(data, shape);

    if (input.sortOrder != null) data.sortOrder = input.sortOrder;
    const updated = await this.prisma.queueLine.update({ where: { id: line.id }, data });
    await this.events?.workspaceChanged(scope, 'lines');
    return updated;
  }

  async setLineArchived(scope: QueueScope, input: { lineId: string; archived: boolean }): Promise<LineRow> {
    const line = await this.lineIn(this.prisma, scope, input.lineId);
    if ((line.archivedAt !== null) === input.archived) return line;
    const updated = await this.prisma.queueLine.update({
      where: { id: line.id },
      data: { archivedAt: input.archived ? new Date() : null },
    });
    await this.events?.workspaceChanged(scope, 'lines');
    return updated;
  }

  /**
   * Set a line's next number, in the open session.
   *
   * The paper and the system drift: the guard starts a fresh roll at 150, or
   * throws away a torn slip. See `positionForNextNumber` for why the cycle is
   * kept.
   */
  async setLineNextNumber(scope: QueueScope, input: { lineId: string; next: number }): Promise<SequenceRow> {
    const sequence = await this.withRetry(async (tx) => {
      const session = await tx.queueSession.findUnique({ where: { openWorkspaceId: scope.workspaceId } });
      if (!session) throw new QueueWriteError('not_started', NOT_STARTED_MESSAGE);

      const line = await this.lineIn(tx, scope, input.lineId);
      if (line.archivedAt) throw new QueueWriteError('invalid', 'That line is archived');

      const current = await this.sequenceFor(tx, scope, session.id, line);
      const result = positionForNextNumber(input.next, line, current);
      if ('refused' in result) {
        throw new QueueWriteError('invalid', `${line.prefix} runs from ${line.startNumber} to ${line.endNumber}`);
      }

      const moved = await tx.queueSequence.updateMany({
        where: { lineId: line.id, sessionId: session.id, lastNumber: current.lastNumber, cycle: current.cycle },
        data: result.position,
      });
      if (moved.count === 0) throw new AllocationConflict();
      return { ...current, ...result.position };
    });
    await this.events?.workspaceChanged(scope, 'lines');
    return sequence;
  }

  // ── windows ───────────────────────────────────────────────────────────────

  async createWindow(scope: QueueScope, actorId: string, input: { name: string }): Promise<WindowRow> {
    const name = this.windowName(input.name);
    let window: WindowRow;
    try {
      window = await this.prisma.$transaction(async (tx) => {
        // Counted inside the transaction, so the cap is not merely advisory.
        await this.assertWindowCap(tx, scope, actorId);
        return tx.queueWindow.create({
          data: { ...scoped(scope), name, nameKey: windowNameKey(name), createdById: actorId },
        });
      });
    } catch (error) {
      throw this.nameTaken(error, name);
    }
    await this.events?.workspaceChanged(scope, 'windows');
    return window;
  }

  async updateWindow(
    scope: QueueScope,
    input: { windowId: string; name?: string | null | undefined; sortOrder?: number | null | undefined },
  ): Promise<WindowRow> {
    const window = await this.windowIn(this.prisma, scope, input.windowId);
    const data: WindowUpdate = {};
    if (input.name != null) {
      data.name = this.windowName(input.name);
      data.nameKey = windowNameKey(data.name);
    }
    if (input.sortOrder != null) data.sortOrder = input.sortOrder;

    let updated: WindowRow;
    try {
      updated = await this.prisma.queueWindow.update({ where: { id: window.id }, data });
    } catch (error) {
      throw this.nameTaken(error, data.name ?? window.name);
    }
    await this.events?.workspaceChanged(scope, 'windows');
    return updated;
  }

  /** Which lines a window calls from. An empty list means ALL lines. */
  async setWindowLines(scope: QueueScope, input: { windowId: string; lineIds: readonly string[] }): Promise<string[]> {
    const lineIds = [...new Set(input.lineIds)];
    const saved = await this.prisma.$transaction(async (tx) => {
      const window = await this.windowIn(tx, scope, input.windowId);
      if (lineIds.length > 0) {
        const lines = await tx.queueLine.findMany({ where: { workspaceId: scope.workspaceId, id: { in: lineIds } } });
        if (lines.length !== lineIds.length) {
          throw new QueueWriteError('not_found', 'One of those lines no longer exists');
        }
      }

      await tx.queueWindowLine.deleteMany({ where: { windowId: window.id } });
      for (const lineId of lineIds) {
        await tx.queueWindowLine.create({ data: { ...scoped(scope), windowId: window.id, lineId } });
      }
      return lineIds;
    });
    await this.events?.workspaceChanged(scope, 'windows');
    return saved;
  }

  /**
   * Archiving FREES the window's seat — an archived window is out of service,
   * and a seat at it would keep its holder from being assigned anywhere else.
   * Unarchiving counts against the cap again.
   */
  async setWindowArchived(
    scope: QueueScope,
    actorId: string,
    input: { windowId: string; archived: boolean },
  ): Promise<WindowRow> {
    let changed = false;
    const window = await this.prisma.$transaction(async (tx) => {
      const current = await this.windowIn(tx, scope, input.windowId);
      if ((current.archivedAt !== null) === input.archived) return current;
      changed = true;

      if (input.archived) {
        await tx.queueSeat.deleteMany({ where: { windowId: current.id } });
        return tx.queueWindow.update({ where: { id: current.id }, data: { archivedAt: new Date() } });
      }

      await this.assertWindowCap(tx, scope, actorId);
      return tx.queueWindow.update({ where: { id: current.id }, data: { archivedAt: null } });
    });
    if (changed) await this.events?.workspaceChanged(scope, 'windows');
    return window;
  }

  // ── seats ─────────────────────────────────────────────────────────────────

  /**
   * Assign a window. See `planAssignment` for replacing and moving.
   *
   * The plan is decided from a read; the write then deletes exactly the seats
   * the plan named and inserts the new one. If anybody changed those seats in
   * between, the insert violates a unique constraint and the assigner is told
   * to try again, rather than a seat they never saw being overwritten.
   */
  async assignWindow(
    scope: QueueScope,
    actorId: string,
    input: { windowId: string; userId: string; confirmReplace: boolean },
  ): Promise<SeatRow | null> {
    const window = await this.windowIn(this.prisma, scope, input.windowId);
    const seats = await this.prisma.queueSeat.findMany({ where: { workspaceId: scope.workspaceId } });
    const assigneeCanServe = this.staff
      ? await this.staff.canServe(scope.organizationId, scope.workspaceId, input.userId)
      : null;

    const plan = planAssignment({
      actorId,
      assigneeId: input.userId,
      window,
      seats,
      assigneeCanServe,
      confirmReplace: input.confirmReplace,
    });

    switch (plan.kind) {
      case 'refused':
        switch (plan.reason) {
          case 'window_archived':
            throw new QueueWriteError('invalid', 'That window is archived');
          case 'only_yourself':
            throw new QueueWriteError('not_permitted', 'You can only assign a window to yourself here');
          case 'cannot_serve':
            throw new QueueWriteError('not_permitted', 'That person cannot serve in this workspace');
          case 'occupied':
            throw new QueueWriteError('occupied', 'That window is occupied. Confirm to replace them.', {
              occupantId: plan.occupantId,
            });
        }
        break;
      case 'unchanged':
        return seats.find((seat) => seat.windowId === window.id) ?? null;
      case 'assign': {
        let seat: SeatRow;
        try {
          seat = await this.prisma.$transaction(async (tx) => {
            if (plan.replacedUserId) {
              await tx.queueSeat.deleteMany({ where: { windowId: plan.windowId, userId: plan.replacedUserId } });
            }
            if (plan.movedFromWindowId) {
              await tx.queueSeat.deleteMany({ where: { workspaceId: scope.workspaceId, userId: plan.userId } });
            }
            return tx.queueSeat.create({
              data: { ...scoped(scope), windowId: plan.windowId, userId: plan.userId, assignedById: actorId },
            });
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new QueueWriteError('conflict', 'Those windows changed while you were assigning. Try again.');
          }
          throw error;
        }
        await this.events?.workspaceChanged(scope, 'seats');
        return seat;
      }
    }
    return null;
  }

  /** Free somebody else's window — `queue:assign_windows`. */
  async freeWindow(scope: QueueScope, input: { windowId: string }): Promise<boolean> {
    const window = await this.windowIn(this.prisma, scope, input.windowId);
    const freed = (await this.prisma.queueSeat.deleteMany({ where: { windowId: window.id } })).count > 0;
    if (freed) await this.events?.workspaceChanged(scope, 'seats');
    return freed;
  }

  /** Leave your own window. No key: ending a shift is not a permission. */
  async releaseMySeat(scope: QueueScope, actorId: string): Promise<boolean> {
    const released = await this.prisma.queueSeat.deleteMany({
      where: { workspaceId: scope.workspaceId, userId: actorId },
    });
    if (released.count > 0) await this.events?.workspaceChanged(scope, 'seats');
    return released.count > 0;
  }

  // ── nicknames ─────────────────────────────────────────────────────────────

  /** The actor's own nickname for public displays. Nobody sets one for somebody else. */
  async setMyNickname(scope: QueueScope, actorId: string, raw: string): Promise<string> {
    const prepared = prepareNickname(raw);
    if ('refused' in prepared) throw refuseText('nickname', prepared.refused);

    const row = await this.prisma.queueStaffNickname.upsert({
      where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId: actorId } },
      create: { ...scoped(scope), userId: actorId, nickname: prepared.text },
      update: { nickname: prepared.text },
    });
    await this.events?.workspaceChanged(scope, 'staff');
    return row.nickname;
  }

  /**
   * Clear a nickname — the actor's own (no key), or anybody's
   * (`queue:manage_windows`). Clearing never writes words; setting is not an
   * admin power.
   *
   * ⚠ Announced, so the name leaves every board at once — including today's
   * recent calls. A nickname is read live, never snapshotted on a ticket.
   */
  async clearNickname(scope: QueueScope, userId: string): Promise<boolean> {
    const cleared = await this.prisma.queueStaffNickname.deleteMany({
      where: { workspaceId: scope.workspaceId, userId },
    });
    if (cleared.count > 0) await this.events?.workspaceChanged(scope, 'staff');
    return cleared.count > 0;
  }

  // ── shared ────────────────────────────────────────────────────────────────

  /** Announces a call that has committed, and hands back its ticket. */
  private async announce(outcome: CallOutcome): Promise<TicketRow> {
    if (outcome.change) await this.events?.ticketChanged(outcome.ticket, outcome.change);
    return outcome.ticket;
  }

  /**
   * Runs a write that can lose a race, and runs it again when it does.
   *
   * ⚠ OUTSIDE the transaction, deliberately. A unique violation aborts a
   * Postgres transaction, so the retry has to be a new one; retrying inside
   * would fail every statement after the first.
   */
  private async withRetry<T>(work: (tx: QueueTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(work);
      } catch (error) {
        const lostRace = error instanceof AllocationConflict || isUniqueViolation(error);
        if (!lostRace) throw error;
        if (attempt >= MAX_ALLOCATION_ATTEMPTS) {
          throw new QueueWriteError('conflict', 'Somebody else called at the same moment. Try again.');
        }
      }
    }
  }

  /**
   * Everything calling needs, refused in the order a person would want to hear
   * it: queuing not started, no window, no such line, not your line.
   */
  private async servingContext(tx: QueueTransaction, scope: QueueScope, actorId: string, lineId: string) {
    const session = await tx.queueSession.findUnique({ where: { openWorkspaceId: scope.workspaceId } });
    if (checkCallingAllowed(session) || !session) throw new QueueWriteError('not_started', NOT_STARTED_MESSAGE);

    const seat = await tx.queueSeat.findUnique({
      where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId: actorId } },
    });
    if (!seat) throw new QueueWriteError('no_window', NO_WINDOW_MESSAGE);

    const window = await tx.queueWindow.findUnique({ where: { id: seat.windowId } });
    if (!window || window.archivedAt) throw new QueueWriteError('no_window', NO_WINDOW_MESSAGE);

    const line = await this.lineIn(tx, scope, lineId);
    if (line.archivedAt) throw new QueueWriteError('invalid', 'That line is archived');

    const served = await tx.queueWindowLine.findMany({ where: { windowId: window.id } });
    const servedLineIds = served.map((link) => link.lineId);
    if (!windowServesLine(servedLineIds, line.id)) {
      throw new QueueWriteError('line_not_served', `${window.name} does not call ${line.prefix}`);
    }

    return { session, window, line };
  }

  /**
   * The sequence for a line in a session, creating it for a line added after
   * Start. A concurrent create is a unique violation, and the retry reads the
   * winner's row.
   */
  private async sequenceFor(
    tx: QueueTransaction,
    scope: QueueScope,
    sessionId: string,
    line: LineRow,
  ): Promise<SequenceRow> {
    const existing = await tx.queueSequence.findUnique({ where: { lineId_sessionId: { lineId: line.id, sessionId } } });
    if (existing) return existing;
    return tx.queueSequence.create({
      data: { ...scoped(scope), lineId: line.id, sessionId, ...freshPosition(line) },
    });
  }

  private async completeServing(tx: QueueTransaction, sessionId: string, windowId: string, now: Date): Promise<void> {
    await tx.queueTicket.updateMany({
      where: { sessionId, windowId, status: 'called' },
      data: { status: 'done', completedAt: now },
    });
  }

  private async ticketById(tx: QueueTransaction, id: string): Promise<TicketRow> {
    const ticket = await tx.queueTicket.findUnique({ where: { id } });
    if (!ticket) throw new QueueWriteError('not_found', 'That number no longer exists');
    return ticket;
  }

  private async lineIn(client: Pick<QueueTransaction, 'queueLine'>, scope: QueueScope, lineId: string) {
    const line = await client.queueLine.findUnique({ where: { id: lineId } });
    if (!line || line.workspaceId !== scope.workspaceId) throw new QueueWriteError('not_found', 'No such line');
    return line;
  }

  private async windowIn(client: Pick<QueueTransaction, 'queueWindow'>, scope: QueueScope, windowId: string) {
    const window = await client.queueWindow.findUnique({ where: { id: windowId } });
    if (!window || window.workspaceId !== scope.workspaceId) throw new QueueWriteError('not_found', 'No such window');
    return window;
  }

  private windowName(raw: string): string {
    const prepared = prepareWindowName(raw);
    if ('refused' in prepared) throw refuseText('window name', prepared.refused);
    return prepared.text;
  }

  private nameTaken(error: unknown, name: string): unknown {
    return isUniqueViolation(error)
      ? new QueueWriteError('name_taken', `There is already a window called ${name}`)
      : error;
  }

  private async assertWindowCap(tx: QueueTransaction, scope: QueueScope, actorId: string): Promise<void> {
    const live = await tx.queueWindow.count({ where: { workspaceId: scope.workspaceId, archivedAt: null } });
    const decision = await this.checker.check({
      actorId,
      key: QUEUE_LIMIT.windows,
      current: live,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
    });
    if (!decision.allowed) {
      throw new QueueWriteError('cap_reached', `This workspace can have ${decision.limit} windows`, {
        limit: decision.limit,
      });
    }
  }
}

function lineShapeMessage(reason: NonNullable<ReturnType<typeof checkLineShape>>): string {
  switch (reason) {
    case 'not_whole_numbers':
      return 'Numbers must be whole numbers';
    case 'start_below_zero':
      return 'A line cannot start below zero';
    case 'end_not_after_start':
      return 'The last number must be after the first';
    case 'end_too_large':
      return 'The last number can be at most 9999';
    case 'pad_out_of_range':
      return 'Padding must be between 0 and 4 digits';
  }
}
