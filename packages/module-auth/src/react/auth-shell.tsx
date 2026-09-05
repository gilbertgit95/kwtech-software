'use client';

import { type ReactNode, useState } from 'react';

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

  /**
   * Every password field gets a reveal toggle, and it is derived from `type`
   * rather than asked for with a prop.
   *
   * A prop would mean six call sites each remembering to pass it, and the one
   * that forgot would be a password field behaving differently from its
   * neighbour — on the change-password form, differently from the field
   * directly above it. Derived, that cannot happen: if it is a password, it can
   * be revealed.
   */
  const isPassword = type === 'password';
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          /*
           * Swapped to `text` while revealed — which is what actually shows the
           * characters, and also what turns off the browser's own password
           * behaviour for as long as it is on. `autoComplete` below is
           * deliberately left alone: a password manager keys off that, not off
           * the type, so filling and saving keep working either way.
           */
          type={isPassword && revealed ? 'text' : type}
          // Named explicitly on every field. Password managers key off these, and
          // a sign-in form they cannot fill is one users work around by picking a
          // password they can remember.
          autoComplete={autoComplete}
          inputMode={inputMode}
          required={required}
          minLength={minLength}
          defaultValue={defaultValue}
          className={`w-full rounded-md border border-input bg-transparent py-2 pl-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            // Room for the button, so a long password does not run underneath it.
            isPassword ? 'pr-10' : 'pr-3'
          }`}
        />

        {isPassword ? (
          <button
            /*
             * `type="button"`, and this is the whole bug it avoids: a <button>
             * inside a <form> defaults to type="submit", so without this,
             * revealing the password would SUBMIT the sign-in form — with
             * whatever had been typed so far.
             */
            type="button"
            onClick={() => setRevealed((shown) => !shown)}
            /*
             * The label names the ACTION and changes with the state, rather
             * than a fixed label plus `aria-pressed`. Both together is the
             * common mistake: a screen reader then says "Hide password, toggle
             * button, pressed", which states the same fact twice and in two
             * directions. Activating a button re-announces its new name, so the
             * change is what carries the state.
             */
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-controls={id}
            /*
             * Kept in the tab order. Skipping it with tabIndex={-1} would put
             * the control out of reach of exactly the people most likely to
             * want it — anyone who cannot see what they typed and is navigating
             * by keyboard.
             */
            className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <EyeIcon crossed={revealed} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The eye, inline rather than from an icon package.
 *
 * `@kwtech/module-auth` has no icon dependency and this is not worth starting
 * one: `lucide-react` would become a peer dependency of every app that adopts
 * this module, for two shapes. The paths are lucide's own `eye` and `eye-off`,
 * so an app that does use lucide gets an icon identical to the rest of its UI.
 *
 * `crossed` is the state being SHOWN, not the action offered: the struck-out eye
 * means "this is currently visible", matching what the toggle did rather than
 * what it will do next.
 */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      // Decorative: the button's aria-label already carries the meaning, and an
      // icon that names itself as well would be announced twice.
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
      {crossed ? (
        <>
          <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
          <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
          <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
          <path d="m2 2 20 20" />
        </>
      ) : (
        <>
          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
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
