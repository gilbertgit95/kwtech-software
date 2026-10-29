'use client';

import { applyDisplay, DEFAULT_DISPLAY, type DisplayPreferences } from '@kwtech/web-ui';
import { useEffect, useMemo, useState } from 'react';
import type { AuthDisplayLayout } from '../../domain/display.js';
import { type AuthClient, createAuthClient } from '../auth-client.js';

export interface DisplaySettingsState {
  /** What is on screen — the choice being tried, then what was saved. Null until loaded. */
  shown: DisplayPreferences | null;
  saving: boolean;
  error: string | null;
  status: string | null;
  /** Whether what is shown is already the defaults, so "Reset" has nothing to do. */
  isDefault: boolean;
  choose(change: Partial<DisplayPreferences>): Promise<void>;
}

/**
 * One layout's display sizes, loaded, previewed and saved (issues #20, #22):
 * the logic of BOTH Display pages — the full site's (`desktop`) and the phone
 * layout's (`mobile`) — kept once, so the two cannot drift apart.
 *
 * A choice applies to this screen at once (`applyDisplay`) and is saved; if the
 * save fails, the screen goes back to what was saved and says why. Nothing is
 * optimistic past that: the saved answer is what stays on screen.
 */
export function useDisplaySettings(
  layout: AuthDisplayLayout,
  options: { client?: AuthClient | undefined; savedMessage: string },
): DisplaySettingsState {
  const api = useMemo(() => options.client ?? createAuthClient(), [options.client]);
  const [saved, setSaved] = useState<DisplayPreferences | null>(null);
  const [shown, setShown] = useState<DisplayPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .myDisplay(layout)
      .then((display) => {
        if (cancelled) return;
        setSaved(display);
        setShown(display);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load your display settings.');
      });
    return () => {
      cancelled = true;
    };
  }, [api, layout]);

  const choose = async (change: Partial<DisplayPreferences>) => {
    if (!saved || !shown || saving) return;
    const next = { ...shown, ...change };
    setShown(next);
    applyDisplay(next);
    setError(null);
    setStatus(null);
    setSaving(true);
    try {
      const stored = await api.updateMyDisplay(change, layout);
      setSaved(stored);
      setShown(stored);
      applyDisplay(stored);
      setStatus(options.savedMessage);
    } catch (cause) {
      setShown(saved);
      applyDisplay(saved);
      setError(cause instanceof Error ? cause.message : 'Could not save your display settings.');
    } finally {
      setSaving(false);
    }
  };

  const isDefault =
    shown !== null && shown.textSize === DEFAULT_DISPLAY.textSize && shown.spacing === DEFAULT_DISPLAY.spacing;

  return { shown, saving, error, status, isDefault, choose };
}
