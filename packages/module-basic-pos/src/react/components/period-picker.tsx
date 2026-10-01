'use client';

import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  periodLabel,
  periodText,
  presetDays,
  REPORT_PRESETS,
  type ReportDays,
  type ReportPreset,
  stepPeriod,
} from '../view/reports.js';
import { buttonClass } from './controls.js';

/** A date field inside the custom range's one frame: the frame draws the border, so the field has none. */
const DAY_INPUT_CLASS =
  'h-7 rounded bg-transparent px-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The reports' period picker (D22): one control that always says WHICH days
 * are showing, with three ways to change them.
 *
 * - The arrows step to the period before or after (`stepPeriod`): yesterday,
 *   the week before, the month before. There is no period after today.
 * - The button opens the presets, each with the days it means, so nobody has
 *   to guess what "This week" covers.
 * - "Custom range…" opens two date fields for any days at all.
 *
 * Every day is a STORE day: `today` is the workspace's, handed in.
 */
export function PeriodPicker({
  days,
  today,
  preset,
  custom,
  editing,
  onPreset,
  onDays,
  onCustom,
  onEditing,
}: {
  /** The period showing, or null while the custom range is not a period yet. */
  days: ReportDays | null;
  today: string;
  preset: ReportPreset;
  /** The custom range as typed; it may not be valid yet. */
  custom: ReportDays;
  /** Whether the custom range's fields are open. */
  editing: boolean;
  onPreset: (preset: Exclude<ReportPreset, 'custom'>) => void;
  /** A period reached by the arrows. */
  onDays: (days: ReportDays) => void;
  onCustom: (custom: ReportDays) => void;
  onEditing: (editing: boolean) => void;
}) {
  // A preset keeps its own name (on the 1st, "This month" is also today); anything else is named by its days.
  const chosen = REPORT_PRESETS.find((entry) => entry.key === preset);
  const label = chosen && chosen.key !== 'custom' ? chosen.label : days ? periodLabel(days, today) : 'Custom';
  const before = days ? stepPeriod(days, -1, today) : null;
  const after = days ? stepPeriod(days, 1, today) : null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="flex min-w-0 items-center rounded-lg border border-border bg-card shadow-sm">
        <button
          type="button"
          aria-label="Previous period"
          className={cn(buttonClass('ghost', 'md'), 'w-9 shrink-0 rounded-r-none px-0')}
          disabled={!before}
          onClick={() => (before ? onDays(before) : undefined)}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonClass('ghost', 'md'),
              'min-w-0 gap-2 rounded-none border-x border-border data-[state=open]:bg-accent',
            )}
          >
            <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-primary" />
            <span className="sr-only">Period: </span>
            <span className="font-semibold">{label}</span>
            <span className="hidden truncate font-normal text-muted-foreground @md:inline">
              {days ? periodText(days.fromDay, days.toDay) : 'Choose the days'}
            </span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72 rounded-xl p-1.5">
            {REPORT_PRESETS.map((entry, index) => {
              const divided = index > 0 && REPORT_PRESETS[index - 1]?.group !== entry.group;
              if (entry.key === 'custom') {
                return (
                  <div key={entry.key}>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      role="menuitemradio"
                      aria-checked={editing}
                      onSelect={() => {
                        // Custom starts from what was showing, so opening it changes nothing yet.
                        if (days) onCustom(days);
                        onEditing(true);
                      }}
                    >
                      <CalendarDays aria-hidden="true" className="text-muted-foreground" />
                      Custom range…
                    </DropdownMenuItem>
                  </div>
                );
              }
              const range = presetDays(entry.key, today);
              const current = !editing && entry.label === label;
              return (
                <div key={entry.key}>
                  {divided ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem role="menuitemradio" aria-checked={current} onSelect={() => onPreset(entry.key)}>
                    <Check aria-hidden="true" className={cn('text-primary', current ? null : 'invisible')} />
                    <span className={cn(current ? 'font-semibold' : null)}>{entry.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {periodText(range.fromDay, range.toDay)}
                    </span>
                  </DropdownMenuItem>
                </div>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label="Next period"
          className={cn(buttonClass('ghost', 'md'), 'w-9 shrink-0 rounded-l-none px-0')}
          disabled={!after}
          onClick={() => (after ? onDays(after) : undefined)}
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </div>

      {editing ? (
        <fieldset className="m-0 flex h-9 min-w-0 items-center gap-1 rounded-lg border border-border bg-card px-1.5 shadow-sm">
          <legend className="sr-only">Custom range</legend>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            From
            <input
              type="date"
              className={DAY_INPUT_CLASS}
              value={custom.fromDay}
              max={custom.toDay || today}
              onChange={(event) => onCustom({ ...custom, fromDay: event.target.value })}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            to
            <input
              type="date"
              className={DAY_INPUT_CLASS}
              value={custom.toDay}
              min={custom.fromDay}
              max={today}
              onChange={(event) => onCustom({ ...custom, toDay: event.target.value })}
            />
          </label>
          {/* Closing keeps the days: only the fields go. With no valid period there is nothing to keep, so no way out but fixing it. */}
          {days ? (
            <button
              type="button"
              aria-label="Close the custom range"
              className={cn(buttonClass('ghost', 'sm'), 'w-7 px-0')}
              onClick={() => onEditing(false)}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}
