/**
 * The plain shapes the domain rules read. Each is the subset of a row a rule
 * needs, so a test builds one from a literal and the server passes a Prisma row
 * straight in.
 */

/** Mirrors `QueueTicketStatus`. No `waiting`: see the enum's comment. */
export const TICKET_STATUSES = ['called', 'done', 'no_show'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface LineView {
  id: string;
  prefix: string;
  startNumber: number;
  endNumber: number;
  padTo: number;
  archivedAt: Date | null;
}

export interface WindowView {
  id: string;
  name: string;
  archivedAt: Date | null;
}

export interface SeatView {
  windowId: string;
  userId: string;
}

export interface SessionView {
  id: string;
  displayCode: string | null;
  failedCodeAttempts: number;
  maxDisplays: number;
  startedAt: Date;
  stoppedAt: Date | null;
}

/**
 * Where a line's numbering stands: the number Call next allocated last, and the
 * pass through the line's range it belongs to. `QueueSequence` stores exactly
 * this.
 */
export interface SequencePosition {
  lastNumber: number;
  cycle: number;
}

export interface TicketView {
  id: string;
  cycle: number;
  number: number;
  status: TicketStatus;
  windowId: string;
}
