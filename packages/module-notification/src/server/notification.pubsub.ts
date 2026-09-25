import type { NotificationPayload } from './notification.render.js';

/**
 * The narrow slice of a pub/sub engine this module needs — declared
 * structurally, never imported. ⚠ A DELIBERATE DUPLICATE of chat's and the
 * queue's ports: importing either would make notifications depend on that
 * module. The app's one engine satisfies all three.
 */
export interface NotificationPubSub {
  publish(trigger: string, payload: unknown): Promise<void>;
  asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T>;
}

/**
 * The events this module publishes, named as data: a trigger is a string on
 * both sides of a wire, and two spellings of one event is a subscription that
 * silently never fires.
 *
 * ⚠ ONE TRIGGER FOR EVERYBODY, not a topic per person. Each event carries its
 * recipient and every subscriber filters on it — one socket, one subscription,
 * and an engine that knows nothing about people.
 */
export const NOTIFICATION_EVENT = {
  item: 'notification.item',
} as const;

/**
 * What happened. `created` and `grouped` carry the notification (a toast needs
 * it); the rest carry ids, and the client re-reads.
 */
export type NotificationChange = 'created' | 'grouped' | 'read' | 'unread' | 'archived' | 'unarchived' | 'recalled';

/**
 * ⚠ `recipientId` is the AUDIENCE, and it is the whole of the filter: an event
 * is delivered to exactly one person's sockets. The notification inside is
 * addressed to them, which is why carrying it is safe.
 */
export interface NotificationEvent {
  kind: NotificationChange;
  recipientId: string;
  ids: string[];
  batchId: string | null;
  notification: NotificationPayload | null;
}

/** Whether `event` is for the person holding this socket. */
export function deliverTo(event: NotificationEvent, actorId: string): boolean {
  return event.recipientId === actorId;
}

/**
 * A no-op engine for a host that mounts the module without subscriptions.
 * Subscribing returns a stream that ENDS rather than one that hangs: a closed
 * stream is debuggable, a silent socket is not.
 */
export const NULL_NOTIFICATION_PUBSUB: NotificationPubSub = {
  async publish() {
    // Deliberately nothing.
  },
  async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
    // Deliberately empty.
  },
};
