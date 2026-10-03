'use client';

import { cn } from '@kwtech/web-ui/react';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { StatusTone } from '../view/labels.js';
import { buttonClass, INPUT_CLASS } from './controls.js';

/*
 * The app's shared frame — the point of sale's (POS-PLAN D23), copied
 * structurally: the section bar, a section's tabs, a list with its detail, a
 * status chip, and the one alert. Laid out by the PANEL's width (container
 * queries), never the viewport's: a grid cell on the Apps page is narrow on a
 * wide screen.
 */

/** The warning-toned count beside a section or a tab: what still needs somebody. */
function CountBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <span className="rounded-full bg-status-warning px-1.5 text-[10px] text-status-warning-foreground tabular-nums">
      {count}
    </span>
  );
}

/**
 * The section bar (D23): the app's MAIN tabs. Drawn as an underlined bar
 * across the whole panel, with an icon each, so it reads as the level above
 * `Tabs` below — two rows of identical buttons gave no hint which row was the
 * section and which was the filter inside it (the operator, 2026-10-01).
 *
 * A narrow panel folds the bar into a menu (D23), on the same rule line.
 */
export function SectionBar<K extends string>({
  sections,
  current,
  onChange,
  label,
  children,
}: {
  sections: readonly { key: K; label: string; icon: LucideIcon; badge?: number }[];
  current: K;
  onChange: (key: K) => void;
  /** The nav's accessible name. */
  label: string;
  /** A quiet note at the bar's far end (the "not live" line). */
  children?: ReactNode;
}) {
  return (
    <nav aria-label={label} className="flex min-w-0 items-center gap-3 border-b border-border">
      <label className="pb-2 @xl:hidden">
        <span className="sr-only">Section</span>
        <select
          className={cn(INPUT_CLASS, 'w-auto font-medium')}
          value={current}
          // The options are the sections above, so the value is one of them.
          onChange={(event) => onChange(event.target.value as K)}
        >
          {sections.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
              {entry.badge ? ` (${entry.badge})` : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="hidden flex-wrap items-center gap-1 @xl:flex">
        {sections.map((entry) => {
          const active = entry.key === current;
          return (
            <button
              key={entry.key}
              type="button"
              aria-current={active ? 'page' : undefined}
              className={cn(
                // -mb-px: the tab's own underline sits ON the bar's rule, not above it.
                '-mb-px inline-flex h-10 items-center gap-2 rounded-t-md border-b-2 px-3 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent/50 hover:text-foreground',
              )}
              onClick={() => onChange(entry.key)}
            >
              <entry.icon aria-hidden="true" className={cn('size-4', active ? 'text-primary' : null)} />
              {entry.label}
              <CountBadge count={entry.badge} />
            </button>
          );
        })}
      </div>
      {children ? <span className="ml-auto pb-2 text-xs text-muted-foreground @xl:pb-0">{children}</span> : null}
    </nav>
  );
}

/**
 * A section's SUB tabs, as a segmented control: small pills in one muted
 * track, hugging their content — deliberately unlike `SectionBar` above, so
 * the two levels cannot be mistaken for each other.
 *
 * `aria-pressed` buttons in a labelled fieldset rather than a tablist: each tab reloads a list, it hides nothing.
 */
export function Tabs<K extends string>({
  tabs,
  current,
  onChange,
  label,
}: {
  tabs: readonly { key: K; label: string; badge?: number }[];
  current: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <fieldset className="m-0 flex w-fit min-w-0 max-w-full shrink-0 flex-wrap gap-0.5 rounded-lg border-0 bg-muted p-0.5">
      <legend className="sr-only">{label}</legend>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={tab.key === current}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            tab.key === current
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          <CountBadge count={tab.badge} />
        </button>
      ))}
    </fieldset>
  );
}

/**
 * List, then detail (D23): side by side in a wide panel, and in a narrow one
 * the detail REPLACES the list, with a back arrow — as the tasks app does.
 */
export function ListDetail({
  list,
  detail,
  onBack,
  backLabel,
}: {
  list: ReactNode;
  /** Null: nothing is open, and a narrow panel shows the list. */
  detail: ReactNode | null;
  onBack: () => void;
  backLabel: string;
}) {
  const open = detail !== null;
  return (
    <div className="grid min-h-0 flex-1 gap-3 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className={cn('min-h-0 flex-col gap-2', open ? 'hidden @3xl:flex' : 'flex')}>{list}</div>
      {open ? (
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-lg border border-border p-3">
          <button type="button" className={cn(buttonClass('ghost', 'sm'), 'w-fit @3xl:hidden')} onClick={onBack}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            {backLabel}
          </button>
          {detail}
        </div>
      ) : (
        <div className="hidden items-center justify-center rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground @3xl:flex">
          Choose one from the list.
        </div>
      )}
    </div>
  );
}

const TONE_CLASS: Readonly<Record<StatusTone, string>> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-status-success text-status-success-foreground',
  warning: 'bg-status-warning text-status-warning-foreground',
  danger: 'bg-status-error text-status-error-foreground',
  info: 'bg-status-info text-status-info-foreground',
};

export function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', TONE_CLASS[tone])}>{label}</span>
  );
}

/** The section's one alert, dismissible. Says what went wrong in the API's own words. */
export function Alert({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-1.5 text-sm text-destructive"
    >
      {message}
      {onDismiss ? (
        <button type="button" className={buttonClass('ghost', 'sm')} onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

/** A quiet line for an empty list or a list still loading. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-1 py-4 text-sm text-muted-foreground">{children}</p>;
}

/** A list row button: the whole row opens the thing. */
export function RowButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-accent' : 'border-border',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
