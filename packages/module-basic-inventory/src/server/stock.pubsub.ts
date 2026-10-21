/**
 * The narrow slice of a pub/sub engine the stock app needs — declared
 * structurally, never imported. A deliberate duplicate of the books', the
 * POS's and the queue's ports: importing any would make this module depend on
 * another. The app's one engine satisfies them all.
 */
export interface StockPubSub {
  publish(trigger: string, payload: unknown): Promise<void>;
  asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T>;
}

/** The one trigger, for every workspace. Each event carries its workspace, and every subscriber filters. */
export const STOCK_EVENT = {
  changed: 'stock.changed',
} as const;

/**
 * What changed, so an open screen knows to read again.
 *
 *   stock — on hand moved (a delivery, a sale, a waste, a count)
 *   setup — items, categories or lists changed
 *   take  — a stock take was started, typed into, confirmed or abandoned
 */
export type StockChange = 'stock' | 'setup' | 'take';

/**
 * One change, as it travels.
 *
 * ⚠ IDS AND FACTS, NEVER CONTENT: the client reads again through the guarded
 * queries. JSON-safe: with Redis behind the engine a payload is JSON on the way.
 */
export interface StockEvent {
  organizationId: string;
  workspaceId: string;
  change: StockChange;
  /** Who did it, so a screen can tell its own change coming back. Null for a sale another module reported. */
  actorId: string | null;
}

/** Whether an event is for a subscriber in this workspace. Stock is the workspace's, so that is the whole filter. */
export function isStockEventFor(event: StockEvent, viewer: { organizationId: string; workspaceId: string }): boolean {
  return event.organizationId === viewer.organizationId && event.workspaceId === viewer.workspaceId;
}

/**
 * A no-op engine, for a host that mounts the module without subscriptions.
 * Subscribing returns a stream that ENDS rather than one that hangs.
 */
export const NULL_STOCK_PUBSUB: StockPubSub = {
  async publish() {
    // Deliberately nothing.
  },
  async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
    // Deliberately empty.
  },
};
