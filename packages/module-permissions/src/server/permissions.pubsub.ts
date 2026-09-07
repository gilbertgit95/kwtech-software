/**
 * The narrow slice of a pub/sub engine this module needs — declared
 * structurally, never imported from one.
 *
 * The same argument as `PermissionsPrismaClient`, one layer over: the module
 * opens no connection and picks no engine, so the host injects whatever it
 * runs. `graphql-subscriptions`' in-memory `PubSub` satisfies this today and
 * serves ONE API instance; the moment `apps/web-server` scales past a single
 * replica it is swapped for `graphql-redis-subscriptions` and nothing in this
 * file, or in any resolver, changes (PLAN §7).
 *
 * It also means the implementation need not be a pub/sub library at all —
 * anything matching the shape works, which is what makes a publish assertable
 * in a test with no engine running.
 */
export const PERMISSIONS_PUBSUB = 'kwtech:permissions-pubsub';

/**
 * Publish and subscribe, and nothing else.
 *
 * `asyncIterableIterator` rather than the deprecated `asyncIterator`:
 * `graphql-subscriptions` 3 renamed it, and naming the old one would bind this
 * interface to a version rather than to a shape.
 */
export interface PermissionsPubSub {
  publish(trigger: string, payload: unknown): Promise<void>;
  asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T>;
}

/**
 * The events this module publishes.
 *
 * Named as data rather than written inline at each call site, for the reason
 * feature keys are: a trigger is a string on both sides of a wire, and two
 * spellings of one event is a subscription that silently never fires. A typo in
 * `publish` cannot be caught by anything downstream — there is no error, just
 * a client that waits forever.
 */
export const PERMISSIONS_EVENT = {
  /**
   * A plan definition was written — created, updated, archived or restored.
   *
   * ⚠ Carries the plan, NOT the entitlement consequences. Editing a plan
   * changes what every subscriber may do, and computing that per affected user
   * would be a query per subscriber per edit. Clients treat this as "the
   * catalogue moved, re-read what you are showing", which is what an open admin
   * screen needs; a caller's own rights are re-resolved at the next request or
   * the next connection, whichever comes first.
   */
  planChanged: 'permissions.plan.changed',
} as const;

export type PermissionsEvent = (typeof PERMISSIONS_EVENT)[keyof typeof PERMISSIONS_EVENT];

/**
 * A no-op engine, for a host that mounts the module without subscriptions.
 *
 * Publishing into nothing is the correct behaviour there, not an error: a
 * worker importing `PermissionsWriteService` for its own sake has no GraphQL
 * layer, no socket, and nobody to tell. Making the write path throw — or making
 * every publish site check whether an engine exists — would push a transport
 * concern into code that is about permissions.
 *
 * Subscribing returns an iterator that ends immediately rather than one that
 * hangs: a caller that somehow reaches it gets a closed stream, which is
 * debuggable, instead of a socket that never delivers.
 */
export const NULL_PUBSUB: PermissionsPubSub = {
  async publish() {
    // Deliberately nothing.
  },
  async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
    // Deliberately empty.
  },
};
