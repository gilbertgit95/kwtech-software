'use client';

import type { ReactNode } from 'react';

/**
 * The frame the settings pages share.
 *
 * Deliberately NOT AuthShell. Those pages are `chrome: 'bare'` — a centred card
 * on an empty background, because you reach them BEFORE you have a session.
 * These are the opposite: they render inside the app shell, next to the
 * navigation, for someone already signed in. Reusing the centred card would put
 * a second frame inside the first.
 *
 * Presentational only, and styled with Tailwind utilities that resolve against
 * @kwtech/web-ui's theme tokens — a module ships components, not a palette.
 */
export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-8 flex flex-col gap-6">{children}</div>
    </div>
  );
}

/**
 * One bordered section per thing a person can change.
 *
 * `danger` shifts the border rather than the whole card: a section that is
 * entirely red reads as broken, while a red edge reads as a warning. Used for
 * the two actions that sign people out.
 */
export function SettingsCard({
  title,
  description,
  danger,
  children,
  footer,
}: {
  title: string;
  description?: string;
  danger?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className={`rounded-lg border bg-card p-6 ${danger ? 'border-destructive/40' : 'border-border'}`}>
      <h2 className="text-sm font-medium text-card-foreground">{title}</h2>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
      {footer ? <div className="mt-4 flex items-center gap-3">{footer}</div> : null}
    </section>
  );
}

/**
 * The result line under a form.
 *
 * `role="status"` for success and `role="alert"` for failure, so a screen reader
 * announces both — a sighted user sees the line appear and, without this, the
 * same information simply does not arrive.
 */
export function SettingsResult({
  error,
  done,
  children,
}: {
  error?: string | null;
  done?: boolean;
  children?: ReactNode;
}) {
  if (error) {
    return (
      <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (done) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {children ?? 'Saved.'}
      </p>
    );
  }
  return null;
}

export function SettingsButton({
  pending,
  danger,
  children,
  onClick,
  type = 'submit',
}: {
  pending?: boolean;
  danger?: boolean;
  children: ReactNode;
  onClick?: () => void;
  type?: 'submit' | 'button';
}) {
  return (
    <button
      type={type === 'submit' ? 'submit' : 'button'}
      onClick={onClick}
      disabled={pending}
      className={`rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60 ${
        danger ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'
      }`}
    >
      {pending ? 'Working…' : children}
    </button>
  );
}
