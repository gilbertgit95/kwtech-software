'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Whether `/notifications` is on screen — modelled on chat's `chat-surface.ts`,
 * not imported from it: the two modules are peers and neither needs the other.
 *
 * While the full inbox is open, new notifications appear IN it, so the bell
 * stays quiet: no toast, no sound. One event, one thing on screen.
 */

let pages = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useNotificationsPageOnScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pages > 0,
    () => false,
  );
}

/** Called by the inbox page while it is mounted. */
export function useRegisterNotificationsPage(): void {
  useEffect(() => {
    pages += 1;
    notify();
    return () => {
      pages -= 1;
      notify();
    };
  }, []);
}
