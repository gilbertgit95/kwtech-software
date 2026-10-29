'use client';

import { applyDisplay, DEFAULT_DISPLAY, type DisplayPreferences } from '@kwtech/web-ui';
import { useEffect, useMemo, useState } from 'react';
import type { AuthDisplayApplyTo, AuthDisplayLayout, AuthDisplaySource } from '../../domain/display.js';
import { type AuthClient, type AuthDisplayView, createAuthClient } from '../auth-client.js';
import { readDeviceId } from '../device-id.js';

export interface DisplaySettingsState {
  /** What is on screen — the choice being tried, then what was saved. Null until loaded. */
  shown: DisplayPreferences | null;
  /** Where the sizes in effect come from: this device's own, the account's, or the defaults. */
  source: AuthDisplaySource | null;
  /** Whether this browser is known as a device; without, every change is the account's. */
  hasDevice: boolean;
  /** Where the next change is saved. */
  applyTo: AuthDisplayApplyTo;
  setApplyTo(applyTo: AuthDisplayApplyTo): void;
  saving: boolean;
  error: string | null;
  status: string | null;
  /** Whether what is shown is already the defaults, so "Reset" has nothing to do. */
  isDefault: boolean;
  choose(change: Partial<DisplayPreferences>): Promise<void>;
  /** Drops this device's own sizes, so it follows the account's again. */
  followAccountSizes(): Promise<void>;
}

/**
 * One layout's display sizes on THIS device, loaded, previewed and saved
 * (issues #20, #22): the logic of BOTH Display pages — the full site's
 * (`desktop`) and the phone layout's (`mobile`) — kept once.
 *
 * Per device (the operator, 2026-10-29): what is shown is this device's own
 * sizes for the layout, else the account's, else the defaults. A change is
 * saved for this device only, or — `applyTo: 'account'` — as the account's,
 * which every device of the person's without sizes of its own follows.
 *
 * A choice applies to this screen at once (`applyDisplay`) and is saved; if the
 * save fails, the screen goes back to what was saved and says why.
 */
export function useDisplaySettings(
  layout: AuthDisplayLayout,
  options: { client?: AuthClient | undefined; savedMessage: (applyTo: AuthDisplayApplyTo) => string },
): DisplaySettingsState {
  const api = useMemo(() => options.client ?? createAuthClient(), [options.client]);
  const [device, setDevice] = useState<string | null>(null);
  const [saved, setSaved] = useState<AuthDisplayView | null>(null);
  const [shown, setShown] = useState<DisplayPreferences | null>(null);
  const [applyTo, setApplyTo] = useState<AuthDisplayApplyTo>('device');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    // After mount: the cookie is the browser's, and the server render has none to read.
    const id = readDeviceId();
    setDevice(id);
    // No device known: the account's sizes are the only ones there are.
    if (!id) setApplyTo('account');
    let cancelled = false;
    api
      .myDisplay(layout, id)
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

  const settle = (view: AuthDisplayView) => {
    setSaved(view);
    setShown(view);
    applyDisplay(view);
  };

  const choose = async (change: Partial<DisplayPreferences>) => {
    if (!saved || !shown || saving) return;
    const next = { ...shown, ...change };
    setShown(next);
    applyDisplay(next);
    setError(null);
    setStatus(null);
    setSaving(true);
    try {
      settle(await api.updateMyDisplay(change, layout, { device, applyTo }));
      setStatus(options.savedMessage(applyTo));
    } catch (cause) {
      setShown(saved);
      applyDisplay(saved);
      setError(cause instanceof Error ? cause.message : 'Could not save your display settings.');
    } finally {
      setSaving(false);
    }
  };

  const followAccountSizes = async () => {
    if (!device || saving) return;
    setError(null);
    setStatus(null);
    setSaving(true);
    try {
      settle(await api.forgetMyDeviceDisplay(layout, device));
      setStatus('This device now uses your usual sizes.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change your display settings.');
    } finally {
      setSaving(false);
    }
  };

  const isDefault =
    shown !== null && shown.textSize === DEFAULT_DISPLAY.textSize && shown.spacing === DEFAULT_DISPLAY.spacing;

  return {
    shown,
    source: saved?.source ?? null,
    hasDevice: device !== null,
    applyTo,
    setApplyTo,
    saving,
    error,
    status,
    isDefault,
    choose,
    followAccountSizes,
  };
}
