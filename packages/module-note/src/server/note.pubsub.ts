import type { NoteChange } from '../domain/events.js';
import type { NoteVisibility } from '../types.js';

/**
 * The narrow slice of a pub/sub engine notes need — declared structurally,
 * never imported. A deliberate duplicate of the queue's and chat's ports:
 * importing either would make notes depend on another module. The app's one
 * engine satisfies all three.
 */
export interface NotePubSub {
  publish(trigger: string, payload: unknown): Promise<void>;
  asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T>;
}

/**
 * The one trigger, for every workspace. Each event carries its workspace, and
 * every subscriber filters — one socket, one subscription, and an engine that
 * knows nothing of tenants.
 */
export const NOTE_EVENT = {
  changed: 'note.changed',
} as const;

/**
 * One change, as it travels.
 *
 * ⚠ IDS AND FACTS, NEVER CONTENT. No title, body, preview or tags: the client
 * reads the note again through the guarded query. So a filtering mistake can at
 * worst tell somebody an id changed, never what it says.
 *
 * ⚠ `authorId` and `visibility` are here FOR THE FILTER (`noteEventFor`),
 * and are the visibility AFTER the change.
 *
 * JSON-safe: with Redis behind the engine a payload is JSON on the way through.
 */
export interface NoteEvent {
  organizationId: string;
  workspaceId: string;
  noteId: string;
  authorId: string;
  visibility: NoteVisibility;
  change: NoteChange;
  /** The version after the change; null once deleted. */
  version: number | null;
  /** Who did it, so a client can tell its own save coming back. */
  actorId: string;
}

/**
 * A no-op engine, for a host that mounts notes without subscriptions.
 * Publishing into nothing is correct there; subscribing returns a stream that
 * ENDS rather than one that hangs, because a closed stream is debuggable and a
 * silent socket is not.
 */
export const NULL_NOTE_PUBSUB: NotePubSub = {
  async publish() {
    // Deliberately nothing.
  },
  async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
    // Deliberately empty.
  },
};
