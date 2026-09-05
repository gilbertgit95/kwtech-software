import { type StatusMessage, sortStatuses } from './status.js';

/**
 * The status bar's backing store: a mutable list, a subscriber set, and a
 * cached snapshot.
 *
 * ## Why a store and not `useState` in the provider
 *
 * The provider is mounted around the WHOLE tree — it has to be, or a page could
 * not publish. Holding the message list in its state means every publish
 * re-renders the entire application: a connectivity poller reporting "still
 * unreachable" every few seconds would re-render every open page with it.
 *
 * With an external store, publishing notifies only the components that actually
 * read it — in practice the bar, and nothing else. The publisher hooks never
 * re-render at all, because they only ever call methods on a stable object.
 *
 * ## Why it is React-free
 *
 * `useSyncExternalStore` wants exactly this shape and nothing more, so keeping
 * React out means the ordering and replacement rules can be tested as plain
 * functions rather than through a renderer.
 */
export interface StatusStore {
  /** Adds a message, or REPLACES the one already holding that id. */
  publish(message: StatusMessage): void;
  /** Removes by id. Unknown ids are ignored — retracting twice is not an error. */
  retract(id: string): void;
  /** Drops every non-sticky message. The app calls this on navigation. */
  clearTransient(): void;
  subscribe(listener: () => void): () => void;
  /** Severity-ordered, and STABLE between mutations — see below. */
  getSnapshot(): readonly StatusMessage[];
}

/**
 * Returned by `getSnapshot` before anything is published, and by the inert
 * store. A shared frozen constant rather than a fresh `[]`, because
 * `useSyncExternalStore` compares snapshots by identity: a new array each call
 * is an infinite render loop, not a slow one.
 */
const EMPTY: readonly StatusMessage[] = Object.freeze([]);

export function createStatusStore(): StatusStore {
  /* Insertion order, which `sortStatuses` then preserves within a level. */
  let messages: StatusMessage[] = [];
  let snapshot: readonly StatusMessage[] = EMPTY;
  const listeners = new Set<() => void>();

  /**
   * Recomputed on mutation and ONLY on mutation.
   *
   * `getSnapshot` is called on every render and must hand back the same
   * reference until something actually changes — sorting inside it would return
   * a new array every time and React would re-render forever looking for a
   * stable value.
   */
  const commit = () => {
    snapshot = messages.length === 0 ? EMPTY : sortStatuses(messages);
    for (const listener of listeners) listener();
  };

  return {
    publish(message) {
      const index = messages.findIndex((existing) => existing.id === message.id);
      /*
       * Replaced IN PLACE, not moved to the end. A poller republishing its own
       * state every few seconds would otherwise reshuffle the bar under
       * whoever is reading it, and two messages of one level would swap places
       * on a timer.
       */
      if (index === -1) messages.push(message);
      else messages[index] = message;
      commit();
    },

    retract(id) {
      const next = messages.filter((message) => message.id !== id);
      // No listeners are notified when nothing was removed: an unmount that
      // retracts an id already gone should not re-render the bar.
      if (next.length === messages.length) return;
      messages = next;
      commit();
    },

    clearTransient() {
      const next = messages.filter((message) => message.sticky);
      if (next.length === messages.length) return;
      messages = next;
      commit();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot: () => snapshot,
  };
}

/**
 * A store that accepts everything and remembers nothing.
 *
 * The fallback when a module page is rendered in an app that has NOT mounted a
 * provider. Throwing there would make adopting a module conditional on adopting
 * the status bar, which is exactly the coupling this package exists to avoid —
 * a module may offer to say something without requiring somewhere to say it.
 */
export const INERT_STATUS_STORE: StatusStore = {
  publish: () => {},
  retract: () => {},
  clearTransient: () => {},
  subscribe: () => () => {},
  getSnapshot: () => EMPTY,
};
