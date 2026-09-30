'use client';

import { cn } from '@kwtech/web-ui/react';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import type { StatusTone } from '../view/manage.js';
import { buttonClass } from './controls.js';

/*
 * The management sections' shared frame (D23): tabs, a list with its detail,
 * a status chip, and the one alert. Laid out by the PANEL's width (container
 * queries), never the viewport's: a grid cell on the Apps page is narrow on a
 * wide screen.
 */

/** A row of tabs. `aria-pressed` buttons in a labelled fieldset rather than a tablist: each tab reloads a list, it hides nothing. */
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
    <fieldset className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={tab.key === current}
          className={cn(buttonClass(tab.key === current ? 'primary' : 'ghost', 'sm'))}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.badge ? (
            <span className="rounded-full bg-status-warning px-1.5 text-[10px] text-status-warning-foreground tabular-nums">
              {tab.badge}
            </span>
          ) : null}
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
