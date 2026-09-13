'use client';

import { cn } from '@kwtech/web-ui/react';
import type React from 'react';

/**
 * The few shared pieces every queue screen uses. Local, not `web-ui`: they have
 * one consumer (§9 rule 8), and `web-ui` has no button to reuse.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function buttonClass(variant: ButtonVariant = 'secondary', size: 'md' | 'lg' = 'md'): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    size === 'lg' ? 'h-16 px-8 text-xl' : 'h-9 px-3 text-sm',
    variant === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary/90',
    variant === 'secondary' && 'border border-border bg-background text-foreground hover:bg-muted',
    variant === 'danger' && 'bg-destructive text-white hover:bg-destructive/90',
    variant === 'ghost' && 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );
}

export const inputClass =
  'h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-border p-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A refusal from the API, in its own words, until somebody dismisses it. */
export function ErrorBanner({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <span>{message}</span>
      <button type="button" className="shrink-0 underline" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

/**
 * The frame both queue pages sit in: a title, what the page is for, and — on a
 * sub-page — a named way back. Chat learned that a sub-page without its back
 * link ships; see `ChatSubPage`.
 */
export function QueuePage({
  title,
  description,
  back,
  actions,
  children,
}: {
  title: string;
  description?: string;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl">
      {back ? (
        // A plain anchor: this package does not depend on Next.
        <a href={back.href} className="text-sm text-muted-foreground hover:text-foreground">
          ← {back.label}
        </a>
      ) : null}
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="mt-6 flex flex-col gap-4">{children}</div>
    </div>
  );
}
