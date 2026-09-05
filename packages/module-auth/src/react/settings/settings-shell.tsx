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
  backTo,
  children,
}: {
  title: string;
  description?: string;
  /**
   * Where this page came from, for a sub page that should offer a way back.
   *
   * On the SHELL rather than left to each page, so every settings screen puts
   * it in the same place and the next one cannot forget — the same call
   * `module-permissions` made on `AdminPage`. Omit it for a page with no
   * parent worth naming.
   *
   * Separate from a form's Cancel button, and both are right: Back is
   * navigation, available before anyone has typed anything; Cancel abandons
   * work in progress and sits with the other form actions.
   */
  backTo?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      {backTo ? <BackLink {...backTo} /> : null}
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

/**
 * The way back out of a settings page.
 *
 * ABOVE the title, not beside it: that is where a reader's eye already goes for
 * "where am I and how do I leave", and it keeps clear of the form actions
 * further down, which do a different job.
 *
 * A plain `<a>`, not next/link — this package must not depend on Next, since a
 * NestJS app imports it too. A full navigation costs nothing anyone will notice.
 *
 * ## Why this is a second copy of `module-permissions`' BackLink
 *
 * Because the two modules may not import each other (PLAN §9), and neither
 * lower home is right: `@kwtech/module-kit` is the CONTRACT both implement and
 * the NestJS server imports, so a styled component does not belong in it; and
 * putting it in `@kwtech/web-ui` would give this module a UI-package dependency
 * it does not otherwise have — an edge the log already flagged as a cost when
 * `module-permissions` took it on for a data grid.
 *
 * Twenty lines of markup is the cheaper duplicate, and it is the same call this
 * package already makes for its inline SVGs rather than starting an icon
 * dependency. Revisit if a third module needs one.
 */
function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="-ml-1 mb-3 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* lucide's `chevron-left`, inline, so it matches an app that uses lucide
          without this package acquiring an icon dependency for one path. */}
      <svg
        // Decorative: the link's own text carries the meaning, and an icon that
        // named itself as well would be announced twice.
        aria-hidden="true"
        focusable="false"
        className="size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
      {/* "Back to Security", not a bare "Back" — a link that names its
          destination tells you where you will land without having to remember
          how you got here, and it does not mislead when someone arrived by a
          deep link rather than by clicking through. */}
      Back to {label}
    </a>
  );
}
