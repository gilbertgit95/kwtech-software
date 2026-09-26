'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type AppHubLayout, type AppHubLayoutSource, effectiveLayout } from '../domain/layout.js';
import type { AppHubClient, AppHubLayoutsView, AppHubScopeView } from './app-hub-client.js';

/**
 * How long after the last change the viewer's layout is saved. Long enough that
 * a burst of drags is one write, short enough that closing the tab rarely loses
 * one — and a pending save is flushed when the page unmounts.
 */
const SAVE_DELAY_MS = 700;

export interface AppHubLayoutState {
  /** Null while loading. */
  layout: AppHubLayout | null;
  source: AppHubLayoutSource;
  /** Whether a workspace default exists — the admin's "Remove default" needs to know. */
  hasWorkspaceDefault: boolean;
  saving: boolean;
  error: string | null;
  dismissError(): void;
  /**
   * Shows `next` and, unless `persist` is false, saves it as the viewer's own
   * layout shortly after. A border being dragged passes false on every move and
   * true on release, so one drag is one write.
   */
  change(next: AppHubLayout, options?: { persist?: boolean }): void;
  resetMine(): Promise<void>;
  saveAsWorkspaceDefault(): Promise<void>;
  resetWorkspaceDefault(): Promise<void>;
}

/**
 * The layout on screen, and every way it changes.
 *
 * @param declared every app the page was given, held or not.
 * @param held the apps the viewer holds, in default order.
 */
export function useAppHubLayout(
  client: AppHubClient,
  scope: AppHubScopeView,
  declared: readonly string[],
  held: readonly string[],
): AppHubLayoutState {
  const [saved, setSaved] = useState<AppHubLayoutsView | null>(null);
  const [layout, setLayout] = useState<AppHubLayout | null>(null);
  const [source, setSource] = useState<AppHubLayoutSource>('default');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Content signatures, so a new array with the same keys is not a new layout.
  const declaredKey = declared.join(' ');
  const heldKey = held.join(' ');
  // biome-ignore lint/correctness/useExhaustiveDependencies: the signatures are the dependency; the arrays are rebuilt every render.
  const lists = useMemo(() => ({ declared: [...declared], held: [...held] }), [declaredKey, heldKey]);

  const { organizationId, workspaceId } = scope;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  /** Fits whichever saved layout applies to what the viewer holds, and shows it. */
  const show = useCallback(
    (next: AppHubLayoutsView) => {
      const fitted = effectiveLayout({ user: next.mine, workspace: next.workspace }, lists.declared, lists.held);
      setLayout(fitted.layout);
      setSource(fitted.source);
    },
    [lists],
  );

  useEffect(() => {
    let cancelled = false;
    client
      .layouts({ organizationId, workspaceId })
      .then((next) => {
        if (cancelled) return;
        setSaved(next);
        show(next);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Still usable: the built-in layout, unsaved, with the reason on screen.
        setError(message(cause));
        show({ mine: null, workspace: null });
      });
    return () => {
      cancelled = true;
    };
  }, [client, organizationId, workspaceId, show]);

  // ── saving the viewer's own layout, debounced ─────────────────────────────

  const pending = useRef<AppHubLayout | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    setSaving(true);
    try {
      await client.saveMine(scopeRef.current, next);
      setSaved((current) => (current ? { ...current, mine: next } : current));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }, [client]);

  // A change still waiting when the page goes away is sent rather than lost.
  useEffect(
    () => () => {
      if (pending.current) void flush();
    },
    [flush],
  );

  const change = useCallback(
    (next: AppHubLayout, options: { persist?: boolean } = {}) => {
      setLayout(next);
      setSource('user');
      if (options.persist === false) return;
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  // ── resets and the workspace default ──────────────────────────────────────

  const run = useCallback(async (work: () => Promise<void>) => {
    setSaving(true);
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }, []);

  const resetMine = useCallback(
    () =>
      run(async () => {
        // A save still waiting would re-create the row this deletes.
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        pending.current = null;
        await client.resetMine(scopeRef.current);
        const next = { mine: null, workspace: saved?.workspace ?? null };
        setSaved(next);
        show(next);
      }),
    [client, run, saved, show],
  );

  const saveAsWorkspaceDefault = useCallback(
    () =>
      run(async () => {
        if (!layout) return;
        await client.saveWorkspace(scopeRef.current, layout);
        setSaved((current) => ({ mine: current?.mine ?? null, workspace: layout }));
      }),
    [client, layout, run],
  );

  const resetWorkspaceDefault = useCallback(
    () =>
      run(async () => {
        await client.resetWorkspace(scopeRef.current);
        const next = { mine: saved?.mine ?? null, workspace: null };
        setSaved(next);
        // Somebody looking at the default they just removed now sees the built-in one.
        if (source === 'workspace') show(next);
      }),
    [client, run, saved, show, source],
  );

  return {
    layout,
    source,
    hasWorkspaceDefault: Boolean(saved?.workspace),
    saving,
    error,
    dismissError: () => setError(null),
    change,
    resetMine,
    saveAsWorkspaceDefault,
    resetWorkspaceDefault,
  };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Something went wrong.';
}
