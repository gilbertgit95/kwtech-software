'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Which chat surface is on screen: the full `/chat` page, or only the header
 * tool and its floating window.
 *
 * ## Why the two need to know about each other
 *
 * Each runs its own `useChat`, and each would otherwise do everything a chat
 * surface does. On `/chat` that is two tones for every message, and a floating
 * window repeating the thread the page already shows. So the page announces
 * itself here, and while it is mounted the header tool stays quiet, hides its
 * window, and hands a picked conversation to the page instead of opening it.
 *
 * ## Why a module-level store rather than a context
 *
 * A context needs a provider above BOTH the header and the page, and the app
 * does not mount one for this module — nor should it have to know that two of
 * chat's components talk. They live in one bundle, in one tab, so a module
 * singleton is exactly their shared scope. It holds nothing but a count and a
 * listener set; there is no data here to leak between users.
 */

let fullPages = 0;
const surfaceListeners = new Set<() => void>();
const openListeners = new Set<(conversationId: string) => void>();

function notify(): void {
  for (const listener of surfaceListeners) listener();
}

function subscribe(listener: () => void): () => void {
  surfaceListeners.add(listener);
  return () => {
    surfaceListeners.delete(listener);
  };
}

/** True while the full chat page is mounted. False on the server, where neither is. */
export function useFullChatOnScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => fullPages > 0,
    () => false,
  );
}

/**
 * Called by the full page: marks it on screen for as long as it is mounted, and
 * opens whatever conversation the header tool hands over meanwhile.
 *
 * A COUNT rather than a flag, so a remount that runs the new effect before the
 * old cleanup — React's order in development — cannot leave it reading false.
 */
export function useRegisterFullChat(onOpen: (conversationId: string) => void): void {
  useEffect(() => {
    fullPages += 1;
    openListeners.add(onOpen);
    notify();
    return () => {
      fullPages -= 1;
      openListeners.delete(onOpen);
      notify();
    };
  }, [onOpen]);
}

/** Asks the full page to open a conversation. Does nothing when no page is listening. */
export function openInFullChat(conversationId: string): void {
  for (const listener of openListeners) listener(conversationId);
}
