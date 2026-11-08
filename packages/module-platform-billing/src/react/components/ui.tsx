'use client';

import { cn } from '@kwtech/web-ui/react';
import { type ReactNode, useId } from 'react';
import type { BillingTone } from '../view/billing-view.js';

/** The Billing page's buttons: a variant over a union (frontend rules: no CVA). */
export function buttonClass(variant: 'primary' | 'secondary' | 'danger' = 'secondary'): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
    variant === 'primary' ? 'bg-primary text-primary-foreground hover:opacity-90' : null,
    variant === 'secondary' ? 'border border-border bg-background hover:bg-muted' : null,
    variant === 'danger' ? 'border border-destructive/40 text-destructive hover:bg-destructive/10' : null,
  );
}

/** A text input's look, with the invalid border. */
export function inputClass(invalid = false): string {
  return cn(
    'w-full rounded-md border bg-background px-3 py-2 text-sm',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    invalid ? 'border-destructive' : 'border-border',
  );
}

/** A bordered section with a heading (semantic `section` + `h2`). */
export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-lg border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions ?? null}
      </div>
      {children}
    </section>
  );
}

/**
 * A labelled field: the label's `htmlFor` and the control share one id, and the
 * note under it (the error, which replaces the hint) is `${id}-note` for the
 * control's `aria-describedby`. An error is announced (`role="alert"`).
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (id: string, describedBy: string) => ReactNode;
}) {
  const id = useId();
  const note = `${id}-note`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children(id, note)}
      {error ? (
        <p id={note} role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={note} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The colours a tone takes, from theme tokens only. */
export function toneClass(tone: BillingTone): string {
  switch (tone) {
    case 'ok':
      return 'border-border bg-card';
    case 'info':
      return 'border-border bg-muted';
    case 'warning':
      return 'border-status-warning-foreground/40 bg-status-warning text-status-warning-foreground';
    case 'alert':
      return 'border-destructive/40 bg-destructive/10';
  }
}

/** A failure, announced, with a way to clear it. */
export function ErrorLine({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <span>{message}</span>
      <button type="button" className="shrink-0 font-medium underline" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

/** Why a control is off, said beside it. */
export function Reason({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs text-muted-foreground">{children}</p>;
}
