import type { TaskChange } from '../domain/events.js';
import type { TaskBoardVisibility } from '../types.js';

/**
 * The narrow slice of a pub/sub engine tasks need — declared structurally,
 * never imported. A deliberate duplicate of the notes', queue's and chat's
 * ports: importing any would make tasks depend on another module. The app's one
 * engine satisfies them all.
 */
export interface TaskPubSub {
  publish(trigger: string, payload: unknown): Promise<void>;
  asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T>;
}

/**
 * The one trigger, for every workspace. Each event carries its workspace and
 * board, and every subscriber filters (`taskEventFor`).
 */
export const TASK_EVENT = {
  changed: 'task.changed',
} as const;

/**
 * One change, as it travels.
 *
 * ⚠ IDS AND FACTS, NEVER CONTENT. No names, titles, descriptions or comments:
 * the client reads again through the guarded queries. So a filtering mistake
 * can at worst tell somebody an id changed, never what it says.
 *
 * ⚠ `ownerId` and `visibility` are here FOR THE FILTER, and are the board's
 * AFTER the change.
 *
 * JSON-safe: with Redis behind the engine a payload is JSON on the way through.
 */
export interface TaskEvent {
  organizationId: string;
  workspaceId: string;
  boardId: string;
  ownerId: string;
  visibility: TaskBoardVisibility;
  change: TaskChange;
  taskId: string | null;
  /** Who did it, so a client can tell its own change coming back. */
  actorId: string;
}

/**
 * A no-op engine, for a host that mounts tasks without subscriptions.
 * Subscribing returns a stream that ENDS rather than one that hangs.
 */
export const NULL_TASK_PUBSUB: TaskPubSub = {
  async publish() {
    // Deliberately nothing.
  },
  async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
    // Deliberately empty.
  },
};
