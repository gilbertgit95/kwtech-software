'use client';

import { cn } from '@kwtech/web-ui/react';
import type { DisplaySettingsState } from './use-display-settings.js';

/**
 * Where display sizes come from, and where a change goes (the operator,
 * 2026-10-29): this device's own, or the account's for this kind of device.
 * Shared by the full site's Display page and the phone's, so both say it the
 * same way.
 *
 *   - a line naming what is in effect here: this device's own sizes, your
 *     usual sizes for phones (or computers), or the defaults;
 *   - "Save for": This device / All my phones — the second sets the
 *     account's sizes for the layout, which every device without sizes of its
 *     own follows, this one included;
 *   - "Use my usual sizes here", when this device has sizes of its own.
 *
 * Nothing to choose without a device id (cookies refused): every change is
 * then the account's, as before devices, and this says so.
 */
export function DisplayScope({
  state,
  kind,
  large = false,
}: {
  state: DisplaySettingsState;
  /** What "all my …" is: `phones` on the phone layout, `computers and tablets` on the full site. */
  kind: string;
  /** The phone's larger targets. */
  large?: boolean;
}) {
  const { source, hasDevice, applyTo, setApplyTo, saving, followAccountSizes } = state;

  if (!hasDevice) {
    return (
      <p className="text-sm text-muted-foreground">
        Changes here are your usual sizes on all your {kind}. This browser keeps no cookies, so it cannot have sizes of
        its own.
      </p>
    );
  }

  const where =
    source === 'device'
      ? 'This device has sizes of its own.'
      : source === 'account'
        ? `This device uses your usual sizes for ${kind}.`
        : `This device uses the standard sizes. You have not chosen sizes for ${kind} yet.`;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {where}
      </p>
      <fieldset className="m-0 border-0 p-0" disabled={saving}>
        <legend className="mb-1.5 text-sm font-medium text-foreground">Save changes for</legend>
        <div className={cn('grid grid-cols-2 gap-1 rounded-xl bg-muted p-1', large ? null : 'max-w-md')}>
          {(
            [
              ['device', 'This device'],
              ['account', `All my ${kind}`],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={cn(
                'flex cursor-pointer items-center justify-center rounded-lg px-2 text-center text-sm font-medium transition-all',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                large ? 'min-h-11' : 'min-h-9',
                applyTo === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              <input
                type="radio"
                name="display-apply-to"
                className="sr-only"
                value={value}
                checked={applyTo === value}
                onChange={() => setApplyTo(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {source === 'device' ? (
        <button
          type="button"
          onClick={() => void followAccountSizes()}
          disabled={saving}
          className="text-sm font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
        >
          Use my usual sizes here
        </button>
      ) : null}
    </div>
  );
}
