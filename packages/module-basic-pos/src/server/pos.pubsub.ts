/**
 * The narrow slice of a pub/sub engine the POS needs — declared structurally,
 * never imported. A deliberate duplicate of the task, note, queue and chat
 * ports: importing any would make the POS depend on another module. The app's
 * one engine satisfies them all.
 */
export interface PosPubSub {
  publish(trigger: string, payload: unknown): Promise<void>;
  asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T>;
}

/** The one trigger, for every workspace. Each event carries its workspace, and every subscriber filters. */
export const POS_EVENT = {
  changed: 'pos.changed',
} as const;

/**
 * What changed, so a till knows what to read again:
 *
 *   catalogue — items, variants or categories: the till's search reloads (D19)
 *   customers — the customer list
 *   settings  — the time zone or the keymap
 *   order     — one order (`orderId`): pending, unpaid and today's lists reload
 */
export type PosChange = 'catalogue' | 'customers' | 'settings' | 'order';

/**
 * One change, as it travels.
 *
 * ⚠ IDS AND FACTS, NEVER CONTENT. No names, prices, customers or totals: the
 * client reads again through the guarded queries — so a cashier's till never
 * receives a cost it may not see by way of an event.
 *
 * JSON-safe: with Redis behind the engine a payload is JSON on the way through.
 */
export interface PosEvent {
  organizationId: string;
  workspaceId: string;
  change: PosChange;
  orderId: string | null;
  /** Who did it, so a till can tell its own change coming back. */
  actorId: string;
}

/**
 * Whether an event is for a subscriber in this workspace. Everything in a
 * store is shared by its members — there are no private orders — so the
 * workspace is the whole filter.
 */
export function isPosEventFor(event: PosEvent, viewer: { organizationId: string; workspaceId: string }): boolean {
  return event.organizationId === viewer.organizationId && event.workspaceId === viewer.workspaceId;
}

/**
 * A no-op engine, for a host that mounts the POS without subscriptions.
 * Subscribing returns a stream that ENDS rather than one that hangs.
 */
export const NULL_POS_PUBSUB: PosPubSub = {
  async publish() {
    // Deliberately nothing.
  },
  async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
    // Deliberately empty.
  },
};
