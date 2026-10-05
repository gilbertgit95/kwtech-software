'use client';

import type { ProcessSchedule, ProcessScheduleKind } from '@kwtech/module-kit';
import { cn } from '@kwtech/web-ui/react';
import { CalendarClock, Plus, Repeat, RotateCcw, X } from 'lucide-react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { describeMinutes } from '../../domain/schedule.js';
import type { JobProcessView } from '../jobs-client.js';
import {
  checkScheduleDraft,
  type ScheduleDraft,
  scheduleDraftOf,
  scheduleNote,
  scheduleOfDraft,
  scheduleText,
} from '../view/jobs-view.js';
import { buttonClass, Field, inputClass } from './ui.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** More times of day than this is an interval wearing a costume. */
const MAX_TIMES = 6;

const KINDS: Readonly<Record<ProcessScheduleKind, { label: string; icon: ReactNode }>> = {
  interval: { label: 'Every so many minutes', icon: <Repeat /> },
  daily: { label: 'At set times of day', icon: <CalendarClock /> },
};

/**
 * ⚠ A real input, hidden only from the eye (`sr-only`), with the styled box as
 * its sibling: the keyboard, the label and a screen reader all still reach an
 * ordinary radio or checkbox. `peer-*` draws the box from the input's state.
 */
const CHOICE_BOX = cn(
  'flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm font-medium text-muted-foreground transition-colors',
  'hover:bg-muted hover:text-foreground',
  'peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground',
  'peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
  'peer-disabled:cursor-default peer-disabled:opacity-50',
);

/**
 * How often, or when, a process runs (JOBS-PLAN §7): "every … minutes" or "at
 * these times", with the module's limits and its default said beside it.
 *
 * ⚠ VALIDATED BY THE SAME RULE THE SERVER RUNS (`checkScheduleDraft`), so a
 * value outside the limits is refused here with the limit said, before any
 * request. The API refuses it again regardless.
 *
 * Mounted with a `key` of the schedule in force, so a saved or reset schedule
 * starts the form again from what the database now holds.
 */
export function ScheduleForm({
  process,
  busy,
  notice,
  onEdit,
  onSave,
  onReset,
}: {
  process: JobProcessView;
  busy: boolean;
  /**
   * "Saved.", or null. ⚠ Held by the PARENT: a save changes the schedule in
   * force, which remounts this form, and a note kept here would be gone before
   * anybody read it.
   */
  notice: string | null;
  /** The draft changed: the note no longer describes what is on screen. */
  onEdit: () => void;
  onSave: (schedule: ProcessSchedule) => void;
  /** Opens the confirmation; the page does the reset. */
  onReset: () => void;
}) {
  const kinds = process.allowedKinds.filter(
    (kind): kind is ProcessScheduleKind => kind === 'interval' || kind === 'daily',
  );
  const limits = { kinds, minEveryMinutes: process.minEveryMinutes };
  const [draft, setDraft] = useState<ScheduleDraft>(() => scheduleDraftOf(process.schedule, process.minEveryMinutes));
  const [error, setError] = useState<string | null>(null);
  const groupId = useId();

  function change(patch: Partial<ScheduleDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
    onEdit();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const refusal = checkScheduleDraft(draft, limits);
    if (refusal) {
      setError(refusal);
      return;
    }
    onSave(scheduleOfDraft(draft));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {kinds.length > 1 ? (
        <fieldset>
          <legend className="sr-only">It runs</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {kinds.map((kind) => (
              <label key={kind} className="relative">
                <input
                  type="radio"
                  className="peer sr-only"
                  name={`${groupId}-kind`}
                  checked={draft.kind === kind}
                  disabled={busy}
                  onChange={() => change({ kind })}
                />
                <span className={cn(CHOICE_BOX, 'h-10 px-3 [&>svg]:size-4')}>
                  {KINDS[kind].icon}
                  {KINDS[kind].label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {draft.kind === 'interval' ? (
        <Field
          label="Every … minutes"
          hint={`At most every ${describeMinutes(process.minEveryMinutes)}: that is the fastest this process can bear.`}
        >
          {(field) => (
            <div className="flex items-center gap-2">
              <input
                {...field}
                type="number"
                inputMode="numeric"
                min={process.minEveryMinutes}
                step={1}
                className={`${inputClass} w-28`}
                value={draft.everyMinutes}
                disabled={busy}
                onChange={(event) => change({ everyMinutes: event.target.value })}
              />
              <span aria-hidden="true" className="text-sm text-muted-foreground">
                minutes
              </span>
            </div>
          )}
        </Field>
      ) : (
        <>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-foreground">At these times</legend>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {draft.times.map((time, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the times are positions in a small editable list with no ids; two may be equal while being typed.
                <div key={index} className="flex items-center">
                  <input
                    type="time"
                    aria-label={`Time ${index + 1}`}
                    className={cn(inputClass, draft.times.length > 1 && 'rounded-r-none border-r-0')}
                    value={time}
                    disabled={busy}
                    onChange={(event) =>
                      change({ times: draft.times.map((one, at) => (at === index ? event.target.value : one)) })
                    }
                  />
                  {draft.times.length > 1 ? (
                    <button
                      type="button"
                      className="grid h-9 w-8 place-items-center rounded-r-lg border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      aria-label={`Remove time ${index + 1}`}
                      disabled={busy}
                      onClick={() => change({ times: draft.times.filter((_, at) => at !== index) })}
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              ))}
              {draft.times.length < MAX_TIMES ? (
                <button
                  type="button"
                  className={cn(buttonClass('ghost'), 'border border-dashed border-border')}
                  disabled={busy}
                  onClick={() => change({ times: [...draft.times, '12:00'] })}
                >
                  <Plus aria-hidden="true" className="size-4" />
                  Add a time
                </button>
              ) : null}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-foreground">On these days</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {WEEKDAYS.map((short, weekday) => (
                <label key={short} className="relative">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    aria-label={WEEKDAY_NAMES[weekday]}
                    checked={draft.weekdays.includes(weekday)}
                    disabled={busy}
                    onChange={(event) =>
                      change({
                        weekdays: event.target.checked
                          ? [...draft.weekdays, weekday]
                          : draft.weekdays.filter((one) => one !== weekday),
                      })
                    }
                  />
                  <span aria-hidden="true" className={cn(CHOICE_BOX, 'h-9 w-12 rounded-full')}>
                    {short}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {scheduleNote({ ...process.schedule, kind: 'daily' }, process.minEveryMinutes)}
            </p>
          </fieldset>
        </>
      )}

      {error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice && !error ? (
        <p role="status" className="rounded-lg bg-status-success px-3 py-2 text-sm text-status-success-foreground">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          The module’s default: {scheduleText(process.defaultSchedule)}.
          {process.scheduleIsDefault ? ' That is what runs now.' : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          {process.scheduleIsDefault ? null : (
            <button type="button" className={buttonClass('ghost')} disabled={busy} onClick={onReset}>
              <RotateCcw aria-hidden="true" className="size-4" />
              Reset to default
            </button>
          )}
          <button type="submit" className={buttonClass('primary')} disabled={busy}>
            {busy ? 'Saving…' : 'Save schedule'}
          </button>
        </div>
      </div>
    </form>
  );
}
