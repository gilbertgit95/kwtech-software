/**
 * The narrow slice of a pub/sub engine the books need — declared structurally,
 * never imported. A deliberate duplicate of the POS, task, note, queue and chat
 * ports: importing any would make the books depend on another module. The
 * app's one engine satisfies them all.
 */
export interface BooksPubSub {
  publish(trigger: string, payload: unknown): Promise<void>;
  asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T>;
}

/** The one trigger, for every workspace. Each event carries its workspace, and every subscriber filters. */
export const BOOKS_EVENT = {
  changed: 'books.changed',
} as const;

/**
 * What changed, so an open screen knows to read again. One kind is enough: the
 * overview's every balance is added up from every entry, so any entry changes
 * all of it.
 */
export type BooksChange = 'books';

/**
 * One change, as it travels.
 *
 * ⚠ IDS AND FACTS, NEVER CONTENT. No amounts and no names: the client reads
 * again through the guarded queries, so nobody learns what an investor was paid
 * by way of an event.
 *
 * JSON-safe: with Redis behind the engine a payload is JSON on the way through.
 */
export interface BooksEvent {
  organizationId: string;
  workspaceId: string;
  change: BooksChange;
  /** Who did it, so a screen can tell its own change coming back. */
  actorId: string;
}

/** Whether an event is for a subscriber in this workspace. The books are the workspace's, so that is the whole filter. */
export function isBooksEventFor(event: BooksEvent, viewer: { organizationId: string; workspaceId: string }): boolean {
  return event.organizationId === viewer.organizationId && event.workspaceId === viewer.workspaceId;
}

/**
 * A no-op engine, for a host that mounts the books without subscriptions.
 * Subscribing returns a stream that ENDS rather than one that hangs.
 */
export const NULL_BOOKS_PUBSUB: BooksPubSub = {
  async publish() {
    // Deliberately nothing.
  },
  async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
    // Deliberately empty.
  },
};
