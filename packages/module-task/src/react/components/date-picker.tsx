'use client';

import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { cn } from '@kwtech/web-ui/react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { type TaskDay, workspaceTaskDay } from '../../domain/dates.js';
import {
  calendarKeyMove,
  longDayLabel,
  monthCells,
  monthLabel,
  monthOf,
  shiftMonth,
  shortDayLabel,
  WEEKDAY_LABELS,
} from '../view/calendar.js';
import { buttonClass } from './controls.js';
import { Popover, type PopoverCloseReason } from './popover.js';

/**
 * A day, picked from a calendar in the app's own colours — instead of the
 * browser's `<input type="date">`, whose calendar ignores the theme and whose
 * typed format follows the machine's locale, not the workspace (the operator's
 * request, 2026-10-09). Either date may be empty (TASK-PLAN decision 11a), so
 * the calendar has *Clear*. ⚠ No second clear button beside the trigger: in
 * the task panel's half-width field it took the room the date itself needs,
 * and "Thu 8 Oct 2026" was cut to "Thu 8 Oct…".
 *
 * - ⚠ "Today" is the WORKSPACE's day (`workspaceTaskDay`), never the browser's:
 *   the ring on today and the *Today* button must agree with what the board
 *   calls overdue (PLAN §13, 2026-09-29).
 * - Opens on the chosen day's month, or this month. ← → move a day, ↑ ↓ a
 *   week, Home and End to the week's ends, Page Up and Page Down a month
 *   (`calendarKeyMove`); Enter or Space picks, because a day is a real button.
 *   One day is in the tab order at a time, so Tab leaves the grid in one press.
 * - ⚠ Picking the day already chosen calls nothing: `onChange` is a write.
 */
export function DatePicker({
  id,
  value,
  disabled = false,
  placeholder = 'No date',
  onChange,
  ...aria
}: {
  /** The trigger's id, for a `<label htmlFor>` outside. */
  id?: string;
  value: TaskDay | null;
  disabled?: boolean;
  placeholder?: string;
  onChange: (day: TaskDay | null) => void;
  'aria-describedby'?: string | undefined;
}) {
  const timeZone = useWorkspaceTimeZone();
  const today = workspaceTaskDay(new Date(), timeZone);
  const [open, setOpen] = useState(false);
  // The day the arrows are on. Its month is the month shown.
  const [focused, setFocused] = useState<TaskDay>(value ?? today);
  // Whether the focus should follow `focused`: after a key, not after the month buttons.
  const follow = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const month = monthOf(focused);

  useEffect(() => {
    if (!open || !follow.current) return;
    follow.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${focused}"]`)?.focus();
  }, [open, focused]);

  const show = () => {
    setFocused(value ?? today);
    follow.current = true;
    setOpen(true);
  };

  const close = (reason: PopoverCloseReason) => {
    setOpen(false);
    if (reason === 'key') triggerRef.current?.focus();
  };

  const pick = (day: TaskDay | null) => {
    close('key');
    if (day !== value) onChange(day);
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const next = calendarKeyMove(focused, event.key);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    follow.current = true;
    setFocused(next);
  };

  const turn = (count: number) => setFocused((current) => `${shiftMonth(monthOf(current), count)}-01`);

  return (
    <span className="flex min-w-0">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        className={cn(
          'flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-sm transition-colors',
          'hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:opacity-60',
          open && 'border-ring',
        )}
        {...aria}
      >
        <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn('min-w-0 flex-1 truncate', value ? null : 'text-muted-foreground')}>
          {value ? shortDayLabel(value) : placeholder}
        </span>
      </button>
      <Popover open={open} anchor={triggerRef} onClose={close} role="dialog" aria-label="Choose a date" className="p-3">
        <div className="flex items-center justify-between gap-2 pb-2">
          <button
            type="button"
            aria-label="Previous month"
            className={cn(buttonClass('ghost', 'sm'), 'w-7 px-0')}
            onClick={() => turn(-1)}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          <p id={headingId} aria-live="polite" className="text-sm font-semibold">
            {monthLabel(month)}
          </p>
          <button
            type="button"
            aria-label="Next month"
            className={cn(buttonClass('ghost', 'sm'), 'w-7 px-0')}
            onClick={() => turn(1)}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div aria-hidden="true" className="grid grid-cols-7 pb-1 text-center text-[0.6875rem] text-muted-foreground">
          {WEEKDAY_LABELS.map((weekday) => (
            <span key={weekday.long}>{weekday.short}</span>
          ))}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a <fieldset> would draw its own border and legend; this only names the days as one set. */}
        <div
          ref={gridRef}
          role="group"
          aria-labelledby={headingId}
          onKeyDown={onGridKeyDown}
          // Six rows' room always, so turning to a longer month never moves the buttons under the pointer.
          className="grid min-h-[12.625rem] grid-cols-7 content-start gap-0.5"
        >
          {monthCells(month).map((cell) => {
            const chosen = cell.day === value;
            return (
              <button
                key={cell.day}
                type="button"
                data-day={cell.day}
                // The full date: "9" alone says nothing to a screen reader.
                aria-label={longDayLabel(cell.day)}
                aria-pressed={chosen}
                aria-current={cell.day === today ? 'date' : undefined}
                tabIndex={cell.day === focused ? 0 : -1}
                onClick={() => pick(cell.day)}
                className={cn(
                  'grid size-8 place-items-center rounded-md text-sm tabular-nums outline-none transition-colors',
                  'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring',
                  cell.inMonth ? null : 'text-muted-foreground/60',
                  // Today is ringed, never filled: the fill is the chosen day's alone.
                  cell.day === today && !chosen && 'font-semibold text-primary ring-1 ring-primary/40 ring-inset',
                  chosen &&
                    'bg-primary font-semibold text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
                )}
              >
                {Number(cell.day.slice(8))}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between gap-2 border-t border-border pt-2">
          <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => pick(today)}>
            Today
          </button>
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            disabled={value === null}
            onClick={() => pick(null)}
          >
            Clear
          </button>
        </div>
      </Popover>
    </span>
  );
}
