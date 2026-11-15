import type { FileEventFacts } from '../domain/events.js';

/**
 * The narrow slice of a pub/sub engine this module needs — declared
 * structurally, never imported. A deliberate duplicate of the tasks' and
 * notes' ports; the app's one engine satisfies them all.
 */
export interface FilePubSub {
  publish(trigger: string, payload: unknown): Promise<void>;
  asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T>;
}

/** The one trigger, for every workspace. Each event names its workspace, and every subscriber filters. */
export const FILE_EVENT = {
  changed: 'file.changed',
} as const;

/**
 * One change, as it travels.
 *
 * ⚠ IDS AND FACTS, NEVER CONTENT: no file name, no size. The client reads its
 * list again through the guarded query, so a filtering mistake could at worst
 * tell somebody an id changed. The audiences carry user ids — FOR THE FILTER
 * (`fileEventReaches`), never sent on to a client.
 *
 * JSON-safe: with Redis behind the engine a payload is JSON on the way through.
 */
export interface FileEvent extends FileEventFacts {
  fileId: string | null;
  /** Who did it, so a client can tell its own change coming back. Null for the clean-up. */
  actorId: string | null;
}

/** A no-op engine: publishing does nothing, and a subscription ends rather than hangs. */
export const NULL_FILE_PUBSUB: FilePubSub = {
  async publish() {
    // Deliberately nothing.
  },
  async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
    // Deliberately empty.
  },
};
