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
import type { StatusTone } from '../view/labels.js';
import { buttonClass } from './controls.js';

/*
 * The app's shared frame — the books', which are the point of sale's (POS-PLAN
 * D23), copied structurally (PLAN §12.87): the section bar, a section's tabs, a status chip, and the one
 * alert. A list's detail opens in `ListDrawer`, shared from `web-ui`. Laid out by the PANEL's width (container
 * queries), never the viewport's: a grid cell on the Apps page is narrow on a
 * wide screen.
 */

/** The warning-toned count beside a section or a tab: what still needs somebody. */
function CountBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <span className="rounded-full bg-status-warning px-1.5 text-[0.625rem] text-status-warning-foreground tabular-nums">
      {count}
    </span>
  );
}

/**
 * The section bar on a narrow panel: one button naming the section you are in,
 * opening a menu of them all. Our own menu rather than a native `<select>`,
 * which cannot draw a section's icon or its count and looked like a form field
 * dropped into the navigation (the operator, 2026-10-03).
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

const TONE_CLASS: Readonly<Record<StatusTone, string>> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-status-success text-status-success-foreground',
  warning: 'bg-status-warning text-status-warning-foreground',
  danger: 'bg-status-error text-status-error-foreground',
  info: 'bg-status-info text-status-info-foreground',
};

export function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium', TONE_CLASS[tone])}>{label}</span>
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
        // ⚠ `relative`: screen-reader-only text in a row is absolutely positioned, and without a positioned ancestor
        // inside the scrolling list it does not scroll with it — it gave the whole app a second scrollbar (the POS's customers).
        'relative flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-accent' : 'border-border',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * One figure across the top of a section: a label, the number, a quiet line
 * under it. With `onClick` it is a filter — pressed while `active` — so the
 * card that says "4 low" is also the way to see them.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  active = false,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  icon: LucideIcon;
  tone?: StatusTone;
  active?: boolean;
  onClick?: (() => void) | undefined;
}) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        {label}
        <span className={cn('grid size-7 place-items-center rounded-full', TONE_CLASS[tone])}>
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
      </span>
      <span className="text-xl font-semibold tracking-tight tabular-nums">{value}</span>
      {hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
    </>
  );
  const frame = cn(
    'flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-3 text-left shadow-xs',
    active ? 'border-primary ring-1 ring-primary' : 'border-border',
  );
  if (!onClick) return <div className={frame}>{body}</div>;
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        frame,
        'transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
      onClick={onClick}
    >
      {body}
    </button>
  );
}

/** A thin bar, 0–1 full, in a status tone. Decorative: the number beside it says the same. */
export function Meter({ fill, tone }: { fill: number; tone: StatusTone }) {
  const bar: Readonly<Record<StatusTone, string>> = {
    neutral: 'bg-muted-foreground/40',
    success: 'bg-status-success-foreground',
    warning: 'bg-status-warning-foreground',
    danger: 'bg-status-error-foreground',
    info: 'bg-status-info-foreground',
  };
  return (
    <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span className={cn('block h-full rounded-full', bar[tone])} style={{ width: `${Math.round(fill * 100)}%` }} />
    </span>
  );
}

/** A quiet note with an icon: a tip, or a warning in its tone. Wraps, never truncates. */
export function Callout({
  icon: Icon,
  tone = 'neutral',
  children,
}: {
  icon: LucideIcon;
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
        tone === 'neutral' ? 'bg-muted/60 text-muted-foreground' : TONE_CLASS[tone],
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** An empty list that says what to do next, with the way to do it. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <p className="font-medium">{title}</p>
      {children ? <p className="max-w-sm text-sm text-muted-foreground">{children}</p> : null}
      {action ?? null}
    </div>
  );
}
