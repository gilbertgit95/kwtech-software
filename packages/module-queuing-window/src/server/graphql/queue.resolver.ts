import { declareScope, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { Inject, SetMetadata } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { MAX_FAILED_CODE_ATTEMPTS } from '../../domain/session.js';
import { QueueWriteError } from '../queue.errors.js';
import type { QueueModuleOptions } from '../queue.options.js';
import type { LineRow, SessionRow, TicketRow, WindowRow } from '../queue.repository.js';
import { type QueueConsoleView, type QueueScope, QueueService } from '../queue.service.js';
import { QUEUE_OPTIONS } from '../queue.tokens.js';
import { QueueWriteService } from '../queue-write.service.js';
import {
  QueueConsoleType,
  QueueDisplayCodeType,
  QueueLineType,
  QueueSeatType,
  QueueSessionType,
  QueueSettingsType,
  QueueStaffMemberType,
  QueueTicketType,
  QueueWindowType,
} from './queue.types.js';

/**
 * The queue's workspace GraphQL surface: the console, calling, windows, lines,
 * seats and sessions.
 *
 * ## ⚠ THE SCOPE IS DECLARED ON THE CLASS, and nothing here works without it
 *
 * Every `queue:*` key is WORKSPACE level. A resolver has no path, so without a
 * declaration `FeatureGuard` resolves app level — where no workspace key
 * participates — and every key below grants nothing to everybody, silently
 * (§12.13). This module may not import `@RequireScope`, so it writes the shared
 * metadata key from `@kwtech/module-kit`. Declared on the CLASS so an operation
 * added later cannot forget it; `surface-coverage.test.ts` fails if it goes.
 * Every operation therefore takes `organizationId` and `workspaceId`.
 *
 * ## Where the guard is, since there is no decorator here
 *
 * Every operation is guarded by its BINDING in `QUEUE_FEATURE_REGISTRY`, which
 * the host composes into `featureRegistry`. Two are deliberately unbound — see
 * the coverage test. The public code exchange is a separate resolver,
 * `QueueDisplayResolver`, so no public marker can ever sit on this class.
 *
 * ## And the guard is only half
 *
 * The key says you may serve in this workspace. The services say whether
 * queuing is running, which window you have, and whether that ticket is yours.
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))
@Resolver()
export class QueueResolver {
  constructor(
    private readonly queue: QueueService,
    private readonly writes: QueueWriteService,
    @Inject(QUEUE_OPTIONS) private readonly options: QueueModuleOptions,
  ) {}

  // ── queries ───────────────────────────────────────────────────────────────

  @Query(() => QueueConsoleType, { name: 'queueConsole' })
  async console(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<QueueConsoleType> {
    return renderConsole(await this.queue.console({ organizationId, workspaceId }, this.actor(gql.req)));
  }

  @Query(() => QueueDisplayCodeType, { name: 'queueDisplayCode', nullable: true })
  async displayCode(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<QueueDisplayCodeType | null> {
    return this.queue.displayCode({ organizationId, workspaceId });
  }

  @Query(() => [QueueStaffMemberType], { name: 'queueStaffCandidates' })
  async staffCandidates(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<QueueStaffMemberType[]> {
    return [...(await this.queue.staffCandidates({ organizationId, workspaceId }))];
  }

  // ── sessions ──────────────────────────────────────────────────────────────

  @Mutation(() => QueueSessionType, { name: 'startQueue' })
  async startQueue(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('continueNumbering', { type: () => Boolean, nullable: true }) continueNumbering?: boolean | null,
  ): Promise<QueueSessionType> {
    const session = await this.writes.startQueue({ organizationId, workspaceId }, this.actor(gql.req), {
      continueNumbering: continueNumbering ?? false,
    });
    return renderSession(session);
  }

  @Mutation(() => Boolean, { name: 'stopQueue' })
  async stopQueue(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<boolean> {
    await this.writes.stopQueue({ organizationId, workspaceId }, this.actor(gql.req));
    return true;
  }

  @Mutation(() => QueueSettingsType, { name: 'setQueueShowStaffNames' })
  async setShowStaffNames(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('show') show: boolean,
  ): Promise<QueueSettingsType> {
    const settings = await this.writes.setShowStaffNames({ organizationId, workspaceId }, show);
    return { enabled: settings.enabled, showStaffNames: settings.showStaffNames };
  }

  // ── calling ───────────────────────────────────────────────────────────────

  @Mutation(() => QueueTicketType, { name: 'callNextQueueTicket' })
  async callNext(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('lineId') lineId: string,
    @Args('clientRequestId', { type: () => String, nullable: true }) clientRequestId?: string | null,
  ): Promise<QueueTicketType> {
    const ticket = await this.writes.callNext({ organizationId, workspaceId }, this.actor(gql.req), {
      lineId,
      clientRequestId,
    });
    return renderTicket(ticket);
  }

  @Mutation(() => QueueTicketType, { name: 'callQueueNumber' })
  async callNumber(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('lineId') lineId: string,
    @Args('number', { type: () => Int }) number: number,
  ): Promise<QueueTicketType> {
    const scope = { organizationId, workspaceId };
    return renderTicket(await this.writes.callNumber(scope, this.actor(gql.req), { lineId, number }));
  }

  @Mutation(() => QueueTicketType, { name: 'recallQueueTicket' })
  async recall(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('ticketId') ticketId: string,
  ): Promise<QueueTicketType> {
    return this.act(gql.req, { organizationId, workspaceId }, ticketId, 'recall');
  }

  @Mutation(() => QueueTicketType, { name: 'completeQueueTicket' })
  async complete(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('ticketId') ticketId: string,
  ): Promise<QueueTicketType> {
    return this.act(gql.req, { organizationId, workspaceId }, ticketId, 'done');
  }

  @Mutation(() => QueueTicketType, { name: 'markQueueTicketNoShow' })
  async noShow(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('ticketId') ticketId: string,
  ): Promise<QueueTicketType> {
    return this.act(gql.req, { organizationId, workspaceId }, ticketId, 'no_show');
  }

  // ── seats ─────────────────────────────────────────────────────────────────

  @Mutation(() => QueueSeatType, { name: 'assignQueueWindow', nullable: true })
  async assignWindow(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('windowId') windowId: string,
    @Args('userId') userId: string,
    @Args('confirmReplace', { type: () => Boolean, nullable: true }) confirmReplace?: boolean | null,
  ): Promise<QueueSeatType | null> {
    const seat = await this.writes.assignWindow({ organizationId, workspaceId }, this.actor(gql.req), {
      windowId,
      userId,
      confirmReplace: confirmReplace ?? false,
    });
    // Names and the serve check come with the console, which the client re-reads.
    return seat ? { windowId: seat.windowId, userId: seat.userId, displayName: seat.userId, canServe: null } : null;
  }

  @Mutation(() => Boolean, { name: 'freeQueueWindow' })
  async freeWindow(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('windowId') windowId: string,
  ): Promise<boolean> {
    return this.writes.freeWindow({ organizationId, workspaceId }, { windowId });
  }

  @Mutation(() => Boolean, { name: 'releaseMyQueueSeat' })
  async releaseMySeat(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<boolean> {
    return this.writes.releaseMySeat({ organizationId, workspaceId }, this.actor(gql.req));
  }

  // ── windows ───────────────────────────────────────────────────────────────

  @Mutation(() => QueueWindowType, { name: 'createQueueWindow' })
  async createWindow(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('name') name: string,
  ): Promise<QueueWindowType> {
    const window = await this.writes.createWindow({ organizationId, workspaceId }, this.actor(gql.req), { name });
    return renderWindow(window, []);
  }

  @Mutation(() => QueueWindowType, { name: 'updateQueueWindow' })
  async updateWindow(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('windowId') windowId: string,
    @Args('name', { type: () => String, nullable: true }) name?: string | null,
    @Args('sortOrder', { type: () => Int, nullable: true }) sortOrder?: number | null,
  ): Promise<QueueWindowType> {
    const window = await this.writes.updateWindow({ organizationId, workspaceId }, { windowId, name, sortOrder });
    return renderWindow(window, await this.queue.windowLineIds(window.id));
  }

  @Mutation(() => QueueWindowType, { name: 'setQueueWindowLines' })
  async setWindowLines(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('windowId') windowId: string,
    @Args('lineIds', { type: () => [String] }) lineIds: string[],
  ): Promise<QueueWindowType> {
    const scope = { organizationId, workspaceId };
    const ids = await this.writes.setWindowLines(scope, { windowId, lineIds });
    const window = await this.writes.updateWindow(scope, { windowId });
    return renderWindow(window, ids);
  }

  @Mutation(() => QueueWindowType, { name: 'setQueueWindowArchived' })
  async setWindowArchived(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('windowId') windowId: string,
    @Args('archived') archived: boolean,
  ): Promise<QueueWindowType> {
    const scope = { organizationId, workspaceId };
    const window = await this.writes.setWindowArchived(scope, this.actor(gql.req), { windowId, archived });
    return renderWindow(window, await this.queue.windowLineIds(window.id));
  }

  // ── lines ─────────────────────────────────────────────────────────────────

  @Mutation(() => QueueLineType, { name: 'createQueueLine' })
  async createLine(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('name') name: string,
    @Args('prefix') prefix: string,
    @Args('startNumber', { type: () => Int, nullable: true }) startNumber?: number | null,
    @Args('endNumber', { type: () => Int, nullable: true }) endNumber?: number | null,
    @Args('padTo', { type: () => Int, nullable: true }) padTo?: number | null,
  ): Promise<QueueLineType> {
    const scope = { organizationId, workspaceId };
    return renderLine(await this.writes.createLine(scope, { name, prefix, startNumber, endNumber, padTo }));
  }

  @Mutation(() => QueueLineType, { name: 'updateQueueLine' })
  async updateLine(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('lineId') lineId: string,
    @Args('name', { type: () => String, nullable: true }) name?: string | null,
    @Args('startNumber', { type: () => Int, nullable: true }) startNumber?: number | null,
    @Args('endNumber', { type: () => Int, nullable: true }) endNumber?: number | null,
    @Args('padTo', { type: () => Int, nullable: true }) padTo?: number | null,
    @Args('sortOrder', { type: () => Int, nullable: true }) sortOrder?: number | null,
  ): Promise<QueueLineType> {
    const scope = { organizationId, workspaceId };
    const line = await this.writes.updateLine(scope, { lineId, name, startNumber, endNumber, padTo, sortOrder });
    return renderLine(line);
  }

  @Mutation(() => QueueLineType, { name: 'setQueueLineArchived' })
  async setLineArchived(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('lineId') lineId: string,
    @Args('archived') archived: boolean,
  ): Promise<QueueLineType> {
    return renderLine(await this.writes.setLineArchived({ organizationId, workspaceId }, { lineId, archived }));
  }

  /** Returns the number Call next will call. */
  @Mutation(() => Int, { name: 'setQueueLineNextNumber' })
  async setLineNextNumber(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('lineId') lineId: string,
    @Args('next', { type: () => Int }) next: number,
  ): Promise<number> {
    await this.writes.setLineNextNumber({ organizationId, workspaceId }, { lineId, next });
    return next;
  }

  // ── nicknames ─────────────────────────────────────────────────────────────

  @Mutation(() => String, { name: 'setMyQueueNickname' })
  async setMyNickname(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('nickname') nickname: string,
  ): Promise<string> {
    return this.writes.setMyNickname({ organizationId, workspaceId }, this.actor(gql.req), nickname);
  }

  @Mutation(() => Boolean, { name: 'clearMyQueueNickname' })
  async clearMyNickname(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<boolean> {
    return this.writes.clearNickname({ organizationId, workspaceId }, this.actor(gql.req));
  }

  @Mutation(() => Boolean, { name: 'clearQueueNickname' })
  async clearNickname(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('userId') userId: string,
  ): Promise<boolean> {
    return this.writes.clearNickname({ organizationId, workspaceId }, userId);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async act(
    request: unknown,
    scope: QueueScope,
    ticketId: string,
    transition: 'recall' | 'done' | 'no_show',
  ): Promise<QueueTicketType> {
    return renderTicket(await this.writes.actOnTicket(scope, this.actor(request), ticketId, transition));
  }

  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new QueueWriteError('not_permitted', 'Not signed in');
    return actorId;
  }
}

function renderSession(row: SessionRow): QueueSessionType {
  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    startedById: row.startedById,
    continuedNumbering: row.continuedNumbering,
    codeLocked: row.failedCodeAttempts >= MAX_FAILED_CODE_ATTEMPTS,
  };
}

function renderLine(row: LineRow): QueueLineType {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    startNumber: row.startNumber,
    endNumber: row.endNumber,
    padTo: row.padTo,
    sortOrder: row.sortOrder,
    archived: row.archivedAt !== null,
  };
}

function renderWindow(row: WindowRow, lineIds: string[]): QueueWindowType {
  return { id: row.id, name: row.name, sortOrder: row.sortOrder, archived: row.archivedAt !== null, lineIds };
}

function renderTicket(row: TicketRow): QueueTicketType {
  return {
    id: row.id,
    lineId: row.lineId,
    label: row.label,
    number: row.number,
    cycle: row.cycle,
    status: row.status,
    windowId: row.windowId,
    windowName: row.windowName,
    calledAt: row.calledAt.toISOString(),
    recallCount: row.recallCount,
  };
}

function renderConsole(view: QueueConsoleView): QueueConsoleType {
  return {
    settings: view.settings,
    session: view.session ? renderSession(view.session) : null,
    lines: view.lines.map(renderLine),
    windows: view.windows.map((window) => renderWindow(window, window.lineIds)),
    seats: view.seats.map((seat) => ({
      windowId: seat.windowId,
      userId: seat.userId,
      displayName: seat.displayName,
      canServe: seat.canServe,
    })),
    myWindowId: view.myWindowId,
    myNickname: view.myNickname,
    serving: view.serving.map(renderTicket),
    recent: view.recent.map(renderTicket),
  };
}
