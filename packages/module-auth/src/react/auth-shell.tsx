'use client';

import type { ReactNode } from 'react';

/**
 * The frame the three auth pages share: a centred card, a title, a slot for the
 * form and one for the links underneath.
 *
 * Presentational only, and styled with Tailwind utility classes that resolve
 * against @kwtech/web-ui's theme tokens. A module ships components, not a
 * design system — so there are no colours here that the app cannot restyle.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
        <div className="mt-8">{children}</div>
        {footer ? <div className="mt-6 text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </main>
  );
}

/**
 * One error presentation for every auth failure.
 *
 * `role="alert"` so a screen reader announces it: a sighted user sees the form
 * turn red, and without this the same information simply does not arrive.
 */
export function AuthError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

export function AuthField({
  label,
  name,
  type = 'text',
  autoComplete,
  required = true,
  minLength,
  defaultValue,
  inputMode,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  defaultValue?: string;
  /**
   * The keypad a phone offers, independent of the input's TYPE.
   *
   * The pair matters for one-time codes: `type="number"` would give the numeric
   * keypad but also strip leading zeros — which a six-digit code has one time
   * in ten — so the field stays `type="text"` and asks for the keypad here.
   */
  inputMode?: 'text' | 'numeric';
}) {
  const id = `auth-${name}`;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        // Named explicitly on every field. Password managers key off these, and
        // a sign-in form they cannot fill is one users work around by picking a
        // password they can remember.
        autoComplete={autoComplete}
        inputMode={inputMode}
        required={required}
        minLength={minLength}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

export function AuthSubmit({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
    >
      {pending ? 'Working…' : children}
    </button>
  );
}
