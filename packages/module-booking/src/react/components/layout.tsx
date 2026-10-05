'use client';

import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  LIST_ITEM,
} from '@kwtech/web-ui/react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { StatusTone } from '../view/day.js';
import { buttonClass } from './controls.js';

/*
 * The app's shared frame — the point of sale's, copied structurally: the
 * section bar, a status chip, the one alert, an empty line and a list row.
 * Laid out by the PANEL's width (container queries), never the viewport's: a
 * grid cell on the Apps page is narrow on a wide screen.
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
 * The section bar on a narrow panel: one button naming the section you are in,
 * opening a menu of them all. Our own menu rather than a native `<select>`,
 * which cannot draw a section's icon or its count and looks like a form field
 * dropped into the navigation.
 */
function SectionMenu<K extends string>({
  sections,
  current,
  onChange,
}: {
  sections: readonly { key: K; label: string; icon: LucideIcon; badge?: number }[];
  current: K;
  onChange: (key: K) => void;
}) {
  const active = sections.find((entry) => entry.key === current);
  // Folded, the other sections' counts are out of sight: say that one of them needs somebody.
  const waitingElsewhere = sections.some((entry) => entry.key !== current && entry.badge);
  return (
    <div className="pb-2 @xl:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'group inline-flex h-10 max-w-full items-center gap-2 rounded-lg border border-border bg-background pr-2.5 pl-3 text-sm font-medium shadow-xs transition-colors',
            'hover:bg-accent data-[state=open]:bg-accent',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {active ? <active.icon aria-hidden="true" className="size-4 shrink-0 text-primary" /> : null}
          <span className="sr-only">Section: </span>
          <span className="truncate">{active?.label ?? 'Choose a section'}</span>
          <CountBadge count={active?.badge} />
          {waitingElsewhere ? (
            <span className="size-2 shrink-0 rounded-full bg-status-warning-foreground">
              <span className="sr-only">Another section needs attention</span>
            </span>
          ) : null}
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56 rounded-xl p-1.5">
          {sections.map((entry) => {
            const chosen = entry.key === current;
            return (
              <DropdownMenuItem
                key={entry.key}
                role="menuitemradio"
                aria-checked={chosen}
                // py-2.5: a narrow panel is usually a phone, so a row is a thumb's height.
                className={cn('gap-2.5 rounded-lg px-2.5 py-2.5', chosen ? 'bg-accent/60 font-semibold' : null)}
                onSelect={() => onChange(entry.key)}
              >
                <entry.icon aria-hidden="true" className={chosen ? 'text-primary' : 'text-muted-foreground'} />
                {entry.label}
                <span className="ml-auto flex items-center gap-2 pl-4">
                  <CountBadge count={entry.badge} />
                  <Check aria-hidden="true" className={cn('text-primary', chosen ? null : 'invisible')} />
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * The section bar: the app's MAIN tabs. Drawn as an underlined bar across the
 * whole panel, with an icon each, so it reads as the level above whatever a
 * section shows under it.
 *
 * A narrow panel folds the bar into a menu, on the same rule line.
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
      <SectionMenu sections={sections} current={current} onChange={onChange} />
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

const TONE_CLASS: Readonly<Record<StatusTone, string>> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-status-success text-status-success-foreground',
  warning: 'bg-status-warning text-status-warning-foreground',
  danger: 'bg-status-error text-status-error-foreground',
  info: 'bg-status-info text-status-info-foreground',
};

/** A tone as a solid mark: the dot in a chip, and the bar down a booking's edge. */
export const TONE_MARK_CLASS: Readonly<Record<StatusTone, string>> = {
  neutral: 'bg-muted-foreground/40',
  success: 'bg-status-success-foreground',
  warning: 'bg-status-warning-foreground',
  danger: 'bg-status-error-foreground',
  info: 'bg-status-info-foreground',
};

/** A status as a pill: a dot of its tone, then its words — read by colour and by text alike. */
export function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASS[tone],
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', TONE_MARK_CLASS[tone])} />
      {label}
    </span>
  );
}

/** A small fact about something, set in a quiet pill: a length, a price, a name. */
export function Tag({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {Icon ? <Icon aria-hidden="true" className="size-3 shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** One number about the day, with what it counts. `tone` colours it when it asks for somebody. */
export function StatTile({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: StatusTone }) {
  const loud = tone !== 'neutral' && value > 0;
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col rounded-xl border border-border px-3 py-2',
        loud ? TONE_CLASS[tone] : 'bg-card',
      )}
    >
      <span className="text-xl font-semibold leading-tight tabular-nums">{value}</span>
      <span className={cn('truncate text-xs', loud ? null : 'text-muted-foreground')}>{label}</span>
    </div>
  );
}

/**
 * An empty list, said properly: what is missing, why it matters, and the one
 * thing to do about it. A blank panel reads as broken; a bare sentence is
 * missed.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  /** The button that fixes it, when the viewer may press it. */
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      {children ? <p className="max-w-sm text-sm text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** The section's one alert, dismissible. Says what went wrong in the API's own words. */
export function Alert({
  message,
  onDismiss,
}: {
  message: string | null;
  /** May be forwarded as undefined: only an error of the viewer's own act can be dismissed. */
  onDismiss?: (() => void) | undefined;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
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

/**
 * A list row button: the whole row opens the thing. It is a choice of the list
 * around it (`LIST_KEYS` on the container), so ↑ ↓ reach it and Enter opens it.
 */
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
      {...LIST_ITEM}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        // ⚠ `relative`: screen-reader-only text in a row (`sr-only`) is absolutely positioned, and without a positioned
        // ancestor inside the scrolling list it does not scroll with it — it sits far down the page instead and gives
        // the whole app a second scrollbar beside the list's own.
        'relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-xl border bg-card px-3 py-2.5 text-left text-sm shadow-xs transition-colors hover:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-accent ring-1 ring-primary' : 'border-border',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
