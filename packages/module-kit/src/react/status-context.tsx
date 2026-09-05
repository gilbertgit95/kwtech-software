'use client';

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { StatusLevel, StatusMessage } from '../status.js';
import { createStatusStore, INERT_STATUS_STORE, type StatusStore } from '../status-store.js';

/**
 * The React half of the status channel — a provider, a reader and a publisher.
 *
 * Everything in this file is client-side. The bar reflects things that happen
 * after a render (a server going away, a save failing), so there is nothing for
 * a server component to hold; what a server component CAN do is render
 * `<PublishStatus>`, which is a client marker that publishes on mount.
 */

/**
 * Defaults to the inert store rather than `null`.
 *
 * A module page must not crash in an app that never mounted a provider — see
 * INERT_STATUS_STORE. The consequence is that a missing provider is silent, so
 * the app-side mount is the thing to check when a message does not appear.
 */
const StatusContext = createContext<StatusStore>(INERT_STATUS_STORE);

export interface StatusProviderProps {
  children: ReactNode;
  /**
   * Supply a store to share one across two roots, or to drive one from a test.
   * Omitted, the provider owns a fresh store for its lifetime.
   */
  store?: StatusStore;
}

export function StatusProvider({ children, store }: StatusProviderProps) {
  /*
   * `useRef`, not `useMemo`: memo is a performance hint React is allowed to
   * discard, and a discarded store would silently drop every sticky message —
   * the connectivity state among them. The ref is a guarantee.
   */
  const owned = useRef<StatusStore | null>(null);
  owned.current ??= createStatusStore();

  return <StatusContext.Provider value={store ?? owned.current}>{children}</StatusContext.Provider>;
}

/**
 * The imperative channel, for event handlers: a failed save, a completed
 * import. Stable across renders, so it is safe in any dependency array.
 */
export function useStatusChannel(): StatusStore {
  return useContext(StatusContext);
}

/**
 * Every current message, severity-ordered. For the bar; almost nothing else
 * should need it.
 *
 * The server snapshot is the same function as the client one — before hydration
 * nothing has published, so both return the shared empty array and the markup
 * matches.
 */
export function useStatusMessages(): readonly StatusMessage[] {
  const store = useStatusChannel();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export interface PublishStatusProps {
  /**
   * Optional. Left out, the component takes a React-generated id that is stable
   * for its own lifetime — which is what makes `<PublishStatus>` correct to
   * render twice on one page without the second silently replacing the first.
   *
   * Give an explicit id when something republishes over time and must occupy
   * ONE line rather than accumulating, as the connectivity monitor does.
   */
  id?: string;
  level: StatusLevel;
  text: string;
  source?: string;
  sticky?: boolean;
  /** Rendered as a button in the bar. Both halves or neither. */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Publishes for as long as it is mounted, and retracts on the way out.
 *
 * Declarative on purpose. The imperative alternative — publish in an effect,
 * remember to retract in every early return — is the version that leaves a
 * stale error on screen after the condition that caused it is gone.
 *
 * Renders nothing. A server component can render it, which is the only way a
 * server-rendered page contributes to the bar.
 */
export function PublishStatus({ id, level, text, source, sticky, actionLabel, onAction }: PublishStatusProps) {
  const store = useStatusChannel();
  const generatedId = useId();
  const messageId = id ?? generatedId;

  /*
   * The handler is held in a ref and re-read at CALL time.
   *
   * An inline `onAction={() => ...}` is a new function on every render. In the
   * effect's dependencies it would retract and republish the message on each
   * one — a message that flickers, and a bar that loses whatever the reader was
   * mid-sentence on. The ref keeps the identity out of the dependency list
   * while still calling the current handler.
   */
  const actionRef = useRef(onAction);
  actionRef.current = onAction;

  const action = useMemo(
    () => (actionLabel ? { label: actionLabel, run: () => actionRef.current?.() } : undefined),
    [actionLabel],
  );

  useEffect(() => {
    store.publish({
      id: messageId,
      level,
      text,
      // Spread rather than assigned: `exactOptionalPropertyTypes` treats an
      // explicit `undefined` as different from an absent key.
      ...(source !== undefined ? { source } : {}),
      ...(sticky !== undefined ? { sticky } : {}),
      ...(action !== undefined ? { action } : {}),
    });
    return () => store.retract(messageId);
  }, [store, messageId, level, text, source, sticky, action]);

  return null;
}
