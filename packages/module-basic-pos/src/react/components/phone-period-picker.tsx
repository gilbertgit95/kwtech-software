'use client';

import {
  BottomSheet,
  cn,
  longDayLabel,
  monthCells,
  monthLabel,
  monthOf,
  shiftMonth,
  WEEKDAY_LABELS,
} from '@kwtech/web-ui/react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Infinity as InfinityIcon } from 'lucide-react';
import { useState } from 'react';
import { type RangeDraft, rangeCell, rangeStep, tapRangeDay } from '../view/phone-period.js';
import {
  periodLabel,
  periodText,
  prepareCustomDays,
  presetDays,
  REPORT_PRESETS,
  type ReportDays,
  type ReportPreset,
  stepPeriod,
} from '../view/reports.js';
import { buttonClass } from './controls.js';

/** The presets a tap applies at once: every one but Custom, which the calendar below them is. */
const QUICK_PRESETS = REPORT_PRESETS.filter(
  (entry): entry is Extract<(typeof REPORT_PRESETS)[number], { key: Exclude<ReportPreset, 'custom'> }> =>
    entry.key !== 'custom',
);

/** A thumb-sized ‹ or › beside the period. */
const ARROW_CLASS =
  'grid size-12 shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground shadow-sm active:bg-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * THE PERIOD PICKER ON A PHONE (issue #72; the operator, 2026-11-05: the full
 * screen's `PeriodPicker` is a desktop control — a small dropdown, two small
 * date pop-overs — on a phone). The same periods and the same rules, made for
 * a thumb:
 *
 * - **One wide row**: ‹ and › a thumb wide (`stepPeriod`: the day, week or
 *   month before or after; nothing after today), and between them the period's
 *   name and its days, so which days are showing is always said.
 * - **Tap it and a bottom sheet rises** with the presets as tiles, each with
 *   its days under its name, and **All dates**: one tap applies and closes.
 * - **A custom range is two taps on one calendar** (`tapRangeDay`): the first
 *   day, then the last, the days between lit; then "Show …". The days are
 *   thumb-sized, nothing after today can be picked, and the range's limits are
 *   the full screen's (`prepareCustomDays`). web-ui's calendar rules
 *   (`monthCells`), not `<input type="date">`, whose calendar ignores the
 *   theme (issue #4).
 *
 * Every day is a STORE day: `today` is the workspace's, handed in.
 */
export function PhonePeriodPicker({
  days,
  today,
  preset,
  onPreset,
  onDays,
  onCustom,
  everyDate,
}: {
  /** The period showing, or null for every date (or a custom range not finished). */
  days: ReportDays | null;
  today: string;
  preset: ReportPreset;
  onPreset: (preset: Exclude<ReportPreset, 'custom'>) => void;
  /** A period reached by the arrows. */
  onDays: (days: ReportDays) => void;
  /** A custom range, whole and valid. */
  onCustom: (days: ReportDays) => void;
  /** Offers "All dates"; `active` while it is what is showing (then `days` is null). */
  everyDate: { active: boolean; onSelect: () => void };
}) {
  const [open, setOpen] = useState(false);
  const allDates = everyDate.active;
  const chosen = REPORT_PRESETS.find((entry) => entry.key === preset);
  const named = chosen && chosen.key !== 'custom' ? chosen.label : days ? periodLabel(days, today) : 'Custom';
  const label = allDates ? 'All dates' : named;
  const before = days ? stepPeriod(days, -1, today) : null;
  const after = days ? stepPeriod(days, 1, today) : null;

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <button
        type="button"
        aria-label="Previous period"
        className={ARROW_CLASS}
        disabled={!before}
        onClick={() => (before ? onDays(before) : undefined)}
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
      </button>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border bg-card px-3 text-left shadow-sm active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CalendarDays aria-hidden="true" className="size-5 shrink-0 text-primary" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="sr-only">Period: </span>
          <span className="truncate text-sm font-semibold">{label}</span>
          <span className="truncate text-xs text-muted-foreground">
            {days ? periodText(days.fromDay, days.toDay) : allDates ? 'Every order' : 'Choose the days'}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <button
        type="button"
        aria-label="Next period"
        className={ARROW_CLASS}
        disabled={!after}
        onClick={() => (after ? onDays(after) : undefined)}
      >
        <ChevronRight aria-hidden="true" className="size-5" />
      </button>

      {open ? (
        <PeriodSheet
          days={days}
          today={today}
          preset={allDates ? null : preset}
          allDates={allDates}
          onClose={() => setOpen(false)}
          onPreset={(next) => {
            onPreset(next);
            setOpen(false);
          }}
          onEveryDate={() => {
            everyDate.onSelect();
            setOpen(false);
          }}
          onCustom={(next) => {
            onCustom(next);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** The sheet: the presets as tiles, All dates, and the custom range's calendar. Mounted while open, so it opens on what is showing. */
function PeriodSheet({
  days,
  today,
  preset,
  allDates,
  onClose,
  onPreset,
  onEveryDate,
  onCustom,
}: {
  days: ReportDays | null;
  today: string;
  /** The preset showing, or null while All dates is. */
  preset: ReportPreset | null;
  allDates: boolean;
  onClose: () => void;
  onPreset: (preset: Exclude<ReportPreset, 'custom'>) => void;
  onEveryDate: () => void;
  onCustom: (days: ReportDays) => void;
}) {
  // The calendar starts on what is showing, so opening the sheet changes nothing yet.
  const [draft, setDraft] = useState<RangeDraft>(
    days ? { fromDay: days.fromDay, toDay: days.toDay } : { fromDay: null, toDay: null },
  );
  const [month, setMonth] = useState(monthOf(days?.toDay ?? today));
  const thisMonth = monthOf(today);
  const step = rangeStep(draft);
  const prepared = draft.fromDay && draft.toDay ? prepareCustomDays(draft.fromDay, draft.toDay) : null;
  const problem = prepared && 'problem' in prepared ? prepared.problem : null;
  const ready = prepared && !('problem' in prepared) ? prepared : null;

  return (
    <BottomSheet
      open
      onClose={onClose}
      title="Choose the days"
      footer={
        <div className="flex flex-col gap-1.5">
          {problem ? (
            <p role="alert" className="text-center text-sm text-destructive">
              {problem}
            </p>
          ) : null}
          <button
            type="button"
            disabled={!ready}
            onClick={() => (ready ? onCustom(ready) : undefined)}
            className={cn(buttonClass('primary'), 'h-14 w-full rounded-2xl text-base')}
          >
            {step === 'first' ? 'Tap the first day' : null}
            {step === 'last' ? 'Now tap the last day' : null}
            {step === 'ready' && draft.fromDay && draft.toDay ? `Show ${periodText(draft.fromDay, draft.toDay)}` : null}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-2 pb-2">
        <section aria-label="Quick picks" className="grid grid-cols-2 gap-2">
          {QUICK_PRESETS.map((entry) => {
            const range = presetDays(entry.key, today);
            const current = preset === entry.key;
            return (
              <button
                key={entry.key}
                type="button"
                aria-pressed={current}
                onClick={() => onPreset(entry.key)}
                className={cn(
                  'flex min-h-14 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  current
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground active:bg-accent',
                )}
              >
                <span className="text-sm font-semibold">{entry.label}</span>
                <span className={cn('text-xs', current ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                  {periodText(range.fromDay, range.toDay)}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={allDates}
            onClick={onEveryDate}
            className={cn(
              'flex min-h-14 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              allDates
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-foreground active:bg-accent',
            )}
          >
            <span className="flex flex-col">
              <span className="text-sm font-semibold">All dates</span>
              <span className={cn('text-xs', allDates ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                Every order
              </span>
            </span>
            <InfinityIcon aria-hidden="true" className="size-5 shrink-0" />
          </button>
        </section>

        <section aria-labelledby="phone-period-custom" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 id="phone-period-custom" className="text-sm font-semibold">
              Custom range
              {preset === 'custom' ? <span className="font-normal text-muted-foreground"> · showing</span> : null}
            </h3>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous month"
                className="grid size-10 place-items-center rounded-full active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <ChevronLeft aria-hidden="true" className="size-5" />
              </button>
              <p aria-live="polite" className="w-32 text-center text-sm font-medium">
                {monthLabel(month)}
              </p>
              <button
                type="button"
                aria-label="Next month"
                // No month after today's: none of its days could be picked.
                disabled={month >= thisMonth}
                className="grid size-10 place-items-center rounded-full active:bg-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                <ChevronRight aria-hidden="true" className="size-5" />
              </button>
            </div>
          </div>
          <div aria-hidden="true" className="grid grid-cols-7 text-center text-xs text-muted-foreground">
            {WEEKDAY_LABELS.map((weekday) => (
              <span key={weekday.long}>{weekday.short}</span>
            ))}
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: a <fieldset> would draw its own border and legend; this only names the days as one set. */}
          <div role="group" aria-label={monthLabel(month)} className="grid grid-cols-7 gap-y-1">
            {monthCells(month).map((cell) => {
              const later = cell.day > today;
              const place = rangeCell(cell.day, draft);
              const end = place === 'start' || place === 'end' || place === 'single';
              return (
                <button
                  key={cell.day}
                  type="button"
                  aria-label={longDayLabel(cell.day)}
                  aria-pressed={place !== null}
                  aria-current={cell.day === today ? 'date' : undefined}
                  disabled={later}
                  onClick={() => setDraft((current) => tapRangeDay(current, cell.day))}
                  className={cn(
                    'grid h-11 place-items-center text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    // The band between the ends runs edge to edge; the ends are round, so the range reads as one shape.
                    place === 'inside' ? 'bg-primary/15' : null,
                    place === 'start' ? 'rounded-l-full bg-primary/15' : null,
                    place === 'end' ? 'rounded-r-full bg-primary/15' : null,
                    cell.inMonth ? null : 'text-muted-foreground/60',
                    later ? 'text-muted-foreground/30' : null,
                  )}
                >
                  <span
                    className={cn(
                      'grid size-10 place-items-center rounded-full',
                      end ? 'bg-primary font-semibold text-primary-foreground' : null,
                      // Today is ringed, never filled: the fill is the range's alone.
                      cell.day === today && !end
                        ? 'font-semibold text-primary ring-1 ring-primary/40 ring-inset'
                        : null,
                    )}
                  >
                    {Number(cell.day.slice(8))}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </BottomSheet>
  );
}
