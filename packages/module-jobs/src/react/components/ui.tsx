'use client';

import { cn } from '@kwtech/web-ui/react';
import { type ReactNode, useId } from 'react';
import type { JobTone } from '../view/jobs-view.js';

/**
 * The few shared pieces the admin page uses. Local, not `web-ui`: they have
 * one consumer (PLAN §9 rule 8), and `web-ui` has no button to reuse.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function buttonClass(variant: ButtonVariant = 'secondary', size: 'sm' | 'md' = 'md'): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
    variant === 'primary' && 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
    variant === 'secondary' && 'border border-border bg-background text-foreground shadow-sm hover:bg-muted',
    variant === 'danger' &&
      'border border-destructive/30 bg-background text-destructive shadow-sm hover:bg-destructive/10',
    variant === 'ghost' && 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );
}

export const inputClass =
  'h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/** A tone as a soft surface: the pale background with its own readable foreground. Both flip with the theme. */
export const TONE_SOFT: Readonly<Record<JobTone, string>> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-status-success text-status-success-foreground',
  warning: 'bg-status-warning text-status-warning-foreground',
  danger: 'bg-status-error text-status-error-foreground',
  info: 'bg-status-info text-status-info-foreground',
};

/** The same tone as a solid dot. */
const TONE_DOT: Readonly<Record<JobTone, string>> = {
  neutral: 'bg-muted-foreground',
  success: 'bg-status-success-foreground',
  warning: 'bg-status-warning-foreground',
  danger: 'bg-status-error-foreground',
  info: 'bg-status-info-foreground',
};

/**
 * A state, as a pill with a dot. `live` makes the dot pulse: something is
 * happening right now (a run queued or under way), as opposed to a state that
 * simply is.
 */
export function StatusChip({ label, tone, live = false }: { label: string; tone: JobTone; live?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        TONE_SOFT[tone],
      )}
    >
      <span aria-hidden="true" className="relative flex size-1.5">
        {live ? (
          <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-75', TONE_DOT[tone])} />
        ) : null}
        <span className={cn('relative inline-flex size-1.5 rounded-full', TONE_DOT[tone])} />
      </span>
      {label}
    </span>
  );
}

/** An icon on a soft, toned tile: the first thing the eye finds on a card. */
export function IconBadge({
  tone,
  size = 'md',
  children,
}: {
  tone: JobTone;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center',
        size === 'sm' && 'size-7 rounded-full [&>svg]:size-3.5',
        size === 'md' && 'size-10 rounded-xl [&>svg]:size-5',
        size === 'lg' && 'size-12 rounded-2xl [&>svg]:size-6',
        TONE_SOFT[tone],
      )}
    >
      {children}
    </span>
  );
}

/** A sentence that needs noticing, on its tone's soft surface: why it is paused, what went wrong. */
export function Callout({
  tone,
  icon,
  role,
  children,
}: {
  tone: JobTone;
  icon?: ReactNode;
  /** `undefined` is allowed so a caller can pass "an alert only when it is failing". */
  role?: 'alert' | 'status' | undefined;
  children: ReactNode;
}) {
  return (
    <div role={role} className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', TONE_SOFT[tone])}>
      {icon ? (
        <span aria-hidden="true" className="mt-0.5 shrink-0 [&>svg]:size-4">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** One number at the top of the page, or one fact at the top of the drawer. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: JobTone;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-card-foreground shadow-sm">
      <IconBadge tone={tone}>{icon}</IconBadge>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {/* Wraps rather than cuts: "At 08:00 every day" is the fact, and half of it is not. */}
        <p className="text-base font-semibold leading-tight text-foreground">{value}</p>
        {hint ? <p className="truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

/** A refusal from the API, in its own words, until somebody dismisses it. */
export function Alert({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <span>{message}</span>
      {onDismiss ? (
        <button
          type="button"
          className="shrink-0 rounded font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

/** A labelled input. The error replaces the hint, and the input is told about whichever is shown. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': note ? noteId : undefined })}
      {note ? (
        <p
          id={noteId}
          role={error ? 'alert' : undefined}
          className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** A titled card inside the drawer. */
export function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A label and its value, for the details of a process. Stacks when the drawer is narrow. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:justify-between sm:gap-6">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-foreground sm:text-right">{children}</dd>
    </div>
  );
}
