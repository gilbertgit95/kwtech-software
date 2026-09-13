import type { TicketStatus } from '../types.js';
import type { TicketRow } from './queue.repository.js';

/**
 * The narrow slice of a pub/sub engine the queue needs — declared structurally,
 * never imported. A deliberate duplicate of chat's port: importing it would
 * make the queue depend on chat. The app's one engine satisfies both.
 */
export interface QueuePubSub {
  publish(trigger: string, payload: unknown): Promise<void>;
  asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T>;
}

/**
 * The events the queue publishes. Named as data, because a trigger is a string
 * on both sides of a wire and two spellings of one event is a subscription that
 * silently never fires.
 *
 * ⚠ THREE TRIGGERS FOR EVERY WORKSPACE, not a topic per workspace. Each event
 * carries its workspace, and every subscriber filters on it. That keeps one
 * socket to one subscription, and the engine unaware of tenants.
 */
export const QUEUE_EVENT = {
  /** A ticket was called, recalled, completed or marked a no-show. */
  call: 'queue.call',
  /** Queuing started or stopped. ⚠ Stop is what takes every TV dark. */
  session: 'queue.session',
  /**
   * Something the console and the board re-read changed: lines, windows, seats,
   * the show-nicknames setting, or a nickname.
   *
   * Carries no rows, like chat's conversation event: what changed is cheap to
   * re-read, and re-reading goes back through the guarded query.
   */
  workspace: 'queue.workspace',
} as const;

export type QueueCallChange = 'called' | 'recalled' | 'done' | 'no_show';
export type QueueSessionChange = 'started' | 'stopped';
export type QueueWorkspaceChange = 'lines' | 'windows' | 'seats' | 'settings' | 'staff';

/**
 * A ticket as it travels. ⚠ ISO STRINGS, never `Date`s: with Redis behind the
 * engine a payload is JSON on the way through, and a `Date` arrives as a string
 * that `toISOString()` then throws on.
 *
 * ⚠ It carries what the public board already shows — number, window, time —
 * plus who called it, which the board turns into a nickname only if the
 * workspace shows names. That is why the staff stream filters by workspace
 * alone. If this ever carries a customer's name or phone number, it needs
 * chat's per-publish audience instead.
 */
export interface QueueTicketPayload {
  id: string;
  lineId: string;
  label: string;
  number: number;
  cycle: number;
  status: TicketStatus;
  windowId: string;
  windowName: string;
  calledById: string;
  calledAt: string;
  recallCount: number;
}

export function toTicketPayload(row: TicketRow): QueueTicketPayload {
  return {
    id: row.id,
    lineId: row.lineId,
    label: row.label,
    number: row.number,
    cycle: row.cycle,
    status: row.status,
    windowId: row.windowId,
    windowName: row.windowName,
    calledById: row.calledById,
    calledAt: new Date(row.calledAt).toISOString(),
    recallCount: row.recallCount,
  };
}

interface InWorkspace {
  organizationId: string;
  workspaceId: string;
}

export interface QueueCallEvent extends InWorkspace {
  kind: 'call';
  sessionId: string;
  change: QueueCallChange;
  ticket: QueueTicketPayload;
}

export interface QueueSessionEvent extends InWorkspace {
  kind: 'session';
  sessionId: string;
  change: QueueSessionChange;
}

export interface QueueWorkspaceEvent extends InWorkspace {
  kind: 'workspace';
  change: QueueWorkspaceChange;
}

export type QueueEvent = QueueCallEvent | QueueSessionEvent | QueueWorkspaceEvent;

/** Every trigger, for a subscriber that wants all of them. */
export const ALL_QUEUE_EVENTS: readonly string[] = Object.values(QUEUE_EVENT);

/**
 * A no-op engine, for a host that mounts the queue without subscriptions.
 * Publishing into nothing is correct there; subscribing returns a stream that
 * ENDS rather than one that hangs, because a closed stream is debuggable and a
 * silent socket is not.
 */
export const NULL_QUEUE_PUBSUB: QueuePubSub = {
  async publish() {
    // Deliberately nothing.
  },
  async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
    // Deliberately empty.
  },
};
