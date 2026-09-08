'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import type { ReactNode } from 'react';

/**
 * The frame this module's ADMINISTRATION pages share.
 *
 * A third shell, beside `AuthShell` (bare, no session yet) and `SettingsPage`
 * (your own account, prose width), because these are a fourth kind of screen:
 * somebody else's account, inside the app shell, sometimes needing the full
 * width for a table. Reusing `SettingsPage` would cap a list of two hundred
 * accounts at a reading measure.
 *
 * It is deliberately NOT `module-permissions`' `AdminPage`, which is the same
 * shape — this module may not import that one (PLAN §9), and the duplication is
 * forty lines of markup rather than a fork of any logic.
 *
 * Presentational only, styled with Tailwind utilities that resolve against
 * @kwtech/web-ui's theme tokens: a module ships components, not a palette, and
 * this one ships no dependency on the component library either — the tables
 * here are plain markup, so adopting user administration costs no new package.
 */
export function AdminShell({
  title,
  description,
  feature,
  layout = 'fill',
  backTo,
  actions,
  children,
}: {
  title: string;
  description?: string | undefined;
  /**
   * The key that gates the page BODY.
   *
   * The same key is on the route descriptor, where it gates the nav entry and
   * the middleware, so one declaration covers three places. None of the three
   * is the real control — every request is authorised again at the API. This
   * decides what a person SEES.
   *
   * Answered through `@kwtech/module-kit/react`, which exists precisely so a
   * module can ask the question without importing the module that answers it.
   * With no provider mounted it reports "holds nothing", so the failure
   * direction is a hidden page rather than a visible one.
   */
  feature: string;
  layout?: 'prose' | 'fill';
  backTo?: { href: string; label: string };
  /** Buttons for the heading row — New, and nothing destructive. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const permitted = useHoldsFeature(feature);

  if (!permitted) {
    return (
      <div className="mx-auto w-full max-w-2xl py-12 text-center">
        <h1 className="text-lg font-semibold text-foreground">Not available to you</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {/*
            Says what is missing without naming the key. The key is a fact about
            the platform's model, not about the reader, and somebody who cannot
            grant it to themselves is not helped by learning its name.
          */}
          Your role does not include managing user accounts. Ask an administrator if you need it.
        </p>
      </div>
    );
  }

  return (
    <div className={layout === 'fill' ? 'flex h-full w-full flex-col' : 'mx-auto w-full max-w-2xl'}>
      {backTo ? (
        <a
          href={backTo.href}
          className="mb-4 inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← {backTo.label}
        </a>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>

      {/* `min-h-0` so a scrolling table inside a flex column actually scrolls
          rather than stretching the page — the one layout rule this shell has
          to get right for the list. */}
      <div className={layout === 'fill' ? 'mt-6 flex min-h-0 flex-1 flex-col' : 'mt-8 flex flex-col gap-6'}>
        {children}
      </div>
    </div>
  );
}
