'use client';

import {
  applyDisplay,
  DEFAULT_DISPLAY,
  type DisplayPreferences,
  SPACING_LABELS,
  SPACINGS,
  TEXT_SIZE_LABELS,
  TEXT_SIZES,
} from '@kwtech/web-ui';
import { cn } from '@kwtech/web-ui/react';
import { useEffect, useId, useMemo, useState } from 'react';
import { type AuthClient, createAuthClient } from '../auth-client.js';
import { SettingsCard, SettingsPage } from './settings-shell.js';

/**
 * How big things are, for this person, on every screen they sign in to
 * (issue #20) — a phone's Settings → Display → Font size.
 *
 * ⚠ A CHOICE APPLIES THE MOMENT IT IS MADE, then saves. Text size is a thing
 * you judge by looking; a Save button would mean choosing blind. If the save
 * fails the page goes back to what is saved and says so, so the screen never
 * shows sizes the account does not hold.
 *
 * Sizes are `@kwtech/web-ui`'s (`TEXT_SIZES`, `SPACINGS`): the same steps the
 * stylesheet knows, which `AUTH_TEXT_SIZES` copies and the app checks.
 */
export function DisplayPage({
  client,
  backTo = { href: '/', label: 'Dashboard' },
}: {
  client?: AuthClient;
  backTo?: { href: string; label: string };
}) {
  const api = useMemo(() => client ?? createAuthClient(), [client]);
  /** What the account holds: what a failed save goes back to. Null while loading. */
  const [saved, setSaved] = useState<DisplayPreferences | null>(null);
  const [shown, setShown] = useState<DisplayPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .myDisplay()
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
  }, [api]);

  const choose = async (change: Partial<DisplayPreferences>) => {
    if (!saved || !shown || saving) return;
    const next = { ...shown, ...change };
    setShown(next);
    applyDisplay(next);
    setError(null);
    setStatus(null);
    setSaving(true);
    try {
      const stored = await api.updateMyDisplay(change);
      setSaved(stored);
      setShown(stored);
      applyDisplay(stored);
      setStatus('Saved. Every screen you sign in to uses these sizes.');
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

  return (
    <SettingsPage
      title="Display"
      description="Make text and the space around it larger or smaller. It follows you to every device you sign in on."
      backTo={backTo}
    >
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {shown ? (
        <>
          <SettingsCard
            title="Text size"
            description="Everything grows with the text: buttons, lists and the space between them."
          >
            <Choices
              label="Text size"
              options={TEXT_SIZES.map((size, index) => ({
                value: size,
                label: TEXT_SIZE_LABELS[size],
                // The "A" grows along the row, as on a phone: the choice is visible before it is read.
                glyph: <span style={{ fontSize: `${0.8 + index * 0.2}rem` }}>A</span>,
              }))}
              value={shown.textSize}
              disabled={saving}
              onChange={(textSize) => void choose({ textSize })}
            />
          </SettingsCard>

          <SettingsCard title="Spacing" description="The room around things, with the text left as it is.">
            <Choices
              label="Spacing"
              options={SPACINGS.map((spacing) => ({ value: spacing, label: SPACING_LABELS[spacing] }))}
              value={shown.spacing}
              disabled={saving}
              onChange={(spacing) => void choose({ spacing })}
            />
          </SettingsCard>

          <SettingsCard title="Preview" description="How a screen looks with these sizes.">
            <Preview />
          </SettingsCard>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              disabled={saving || isDefault}
              onClick={() => void choose(DEFAULT_DISPLAY)}
            >
              Reset to normal
            </button>
            <span role="status" className="text-sm text-muted-foreground">
              {saving ? 'Saving…' : status}
            </span>
          </div>

          <p className="text-sm text-muted-foreground">
            Colours and light or dark mode are in the theme switch at the top of every page.
          </p>
        </>
      ) : error ? null : (
        // A skeleton, as the profile page: the page's shape is known, so the layout does not jump.
        <SettingsCard title="Text size">
          <div className="h-16 animate-pulse rounded-md bg-muted" />
        </SettingsCard>
      )}
    </SettingsPage>
  );
}

/**
 * One choice from a short row, as radio buttons: a screen reader hears "Text
 * size, Large, 3 of 5", and ← → move along the row as the platform's own
 * radios do.
 */
function Choices<T extends string>({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string; glyph?: React.ReactNode }[];
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="m-0 border-0 p-0" disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex min-w-20 flex-1 cursor-pointer flex-col items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              option.value === value ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-accent',
            )}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            {option.glyph ? (
              <span aria-hidden="true" className="flex h-8 items-end font-semibold leading-none">
                {option.glyph}
              </span>
            ) : null}
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A piece of an ordinary screen — a heading, a line of a list, two buttons — in the app's own components' sizes. */
function Preview() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Order #41 · Table 5</span>
        <span className="text-sm tabular-nums">₱250.00</span>
      </div>
      <p className="text-xs text-muted-foreground">2 items · paid by cash · 10:42 AM</p>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <span className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm">Hold</span>
        <span className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm text-primary-foreground">
          Pay ₱250.00
        </span>
      </div>
    </div>
  );
}
