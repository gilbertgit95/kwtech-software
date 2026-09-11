'use client';

import { cn } from '@kwtech/web-ui/react';
import { AVAILABILITY_ORDER } from '../../domain/availability.js';
import type { ChatMyAvailabilityView } from '../chat-client.js';

/**
 * What you say you are doing.
 *
 * ⚠ TWO PLAIN SELECTS, not a styled dropdown. This is a preference somebody
 * touches occasionally, a native control is keyboard- and screen-reader-correct
 * for free, and on a phone it opens the OS picker — which is better than
 * anything a popover would do at that width.
 *
 * ⚠ THE DURATION IS PART OF THE SAME ACT. "Busy" and "busy until 3pm" are one
 * decision, and a separate control for the timer would let somebody set a state
 * they never meant to keep. Choosing a duration with no state, or changing the
 * state, sends both together.
 */

/** ⚠ Written out rather than derived: each needs a name a person would use. */
const LABELS: Record<string, string> = {
  available: 'Available',
  busy: 'Busy',
  dnd: 'Do not disturb',
  away: 'Away',
  invisible: 'Appear offline',
};

/**
 * ⚠ The empty value means "until I change it", NOT "expire now".
 *
 * `clearAtFrom` reads a missing or non-positive duration as no timer at all, so
 * these two agree by construction — and the option has to exist, because the
 * commonest answer is that somebody does not want their state quietly reverting.
 */
const DURATIONS: readonly { minutes: number | null; label: string }[] = [
  { minutes: null, label: 'Until I change it' },
  { minutes: 30, label: 'For 30 minutes' },
  { minutes: 60, label: 'For 1 hour' },
  { minutes: 240, label: 'For 4 hours' },
];

export function AvailabilityPicker({
  mine,
  busy,
  onChange,
}: {
  mine: ChatMyAvailabilityView | null;
  busy: boolean;
  onChange: (availability: string, forMinutes: number | null) => void;
}) {
  // Nothing is drawn until the server has said what the current state is.
  // Rendering "Available" first and correcting it a moment later would tell
  // somebody who chose to appear offline that they are visible.
  if (!mine) return null;

  const timed = mine.clearAt !== null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
      <label className="sr-only" htmlFor="chat-availability">
        Your availability
      </label>
      <select
        id="chat-availability"
        value={mine.availability}
        disabled={busy}
        onChange={(event) => onChange(event.target.value, null)}
        className={cn(
          'min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        )}
      >
        {AVAILABILITY_ORDER.map((value) => (
          <option key={value} value={value}>
            {LABELS[value] ?? value}
          </option>
        ))}
      </select>

      {/*
        ⚠ Offered only once there is something to time. "Available for 30
        minutes" is not a thing anybody means — the default state has nothing to
        revert to — and offering it would invite somebody to set a timer that
        does nothing.
      */}
      {mine.availability !== 'available' ? (
        <>
          <label className="sr-only" htmlFor="chat-availability-for">
            How long
          </label>
          <select
            id="chat-availability-for"
            value={timed ? 'timed' : ''}
            disabled={busy}
            onChange={(event) => onChange(mine.availability, Number(event.target.value) || null)}
            className={cn(
              'min-w-0 rounded-md border border-border bg-background px-2 py-1 text-xs',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            )}
          >
            {/*
              The running timer as a row of its own, so the control shows the
              truth rather than snapping back to "until I change it" — the
              server holds a moment, and this cannot name the duration it came
              from.
            */}
            {timed ? <option value="timed">{`Until ${clock(mine.clearAt)}`}</option> : null}
            {DURATIONS.map((option) => (
              <option key={option.label} value={option.minutes ?? ''}>
                {option.label}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}

function clock(iso: string | null): string {
  if (!iso) return '';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
