'use client';

import type { ReactNode } from 'react';
import type { DenialReason, FeatureKey } from '../../types.js';
import { FeatureDenied } from '../feature-denied.js';
import { FeatureGate } from '../feature-gate.js';

/**
 * The frame the module's administration pages share.
 *
 * Deliberately NOT `AuthShell` — these render inside the app shell, next to the
 * navigation, for someone already signed in. It is the same shape as
 * `module-auth`'s `SettingsPage` and for the same reason: four pages that each
 * open with their own heading markup drift apart by the third one.
 *
 * Presentational only, styled with Tailwind utilities that resolve against
 * @kwtech/web-ui's theme tokens — a module ships components, not a palette.
 */
export function AdminPage({
  title,
  description,
  feature,
  layout = 'prose',
  backTo,
  children,
}: {
  title: string;
  // `| undefined` explicitly, so a caller can forward an optional description.
  description?: string | undefined;
  /**
   * What KIND of screen this is, which is one decision rather than two.
   *
   *   'prose'  a document — a form, a settings panel, an explanation. Capped at
   *            a readable measure and centred, because a paragraph running the
   *            full width of a 32-inch monitor is unreadable.
   *   'fill'   a data screen — a grid, a table, a board. Full width, and its
   *            body fills the height left over after the heading, so the thing
   *            inside scrolls rather than the page.
   *
   * One prop, not a `wide` and a `fill`: a screen that wants the whole width
   * wants the whole height for the same reason, and two independent flags would
   * make three of the four combinations meaningless.
   */
  layout?: 'prose' | 'fill';
  /**
   * The key that gates the page BODY.
   *
   * The same key is on the route descriptor, where it gates the nav entry and
   * the middleware. One declaration, three enforcement points — which is what
   * stops a link outliving the permission behind it.
   *
   * None of the three is the real control: every request carries the bearer
   * token and is authorised at the API. This is what a person sees, not what
   * they can reach.
   */
  feature: FeatureKey;
  /**
   * Where this page came from, for a sub page that should offer a way back.
   *
   * On the SHELL rather than left to each page, so the three feature sub pages
   * put it in the same place and the fourth one cannot forget. Omitted on a
   * top-level page, which has nothing to go back to.
   *
   * Note this is separate from a form's Cancel button, and both are right: Back
   * is navigation, available before anyone has typed anything; Cancel abandons
   * work in progress and sits with the other form actions. Removing either
   * leaves a gap — a form with only Cancel offers no way out until you have
   * started, and one with only Back makes leaving look like a page control
   * rather than a decision about the form.
   */
  backTo?: { href: string; label: string } | undefined;
  children: ReactNode;
}) {
  return (
    <FeatureGate
      allOf={[feature]}
      /*
        The denial screen gets the back link too. Someone refused a page needs a
        way off it more than anyone — and without one their only option is the
        browser's Back, which on a redirect chain does not always land where
        they started.
      */
      renderDenied={(reason) => <AdminDenied title={title} reason={reason} backTo={backTo} />}
    >
      {/*
        `h-full` on the fill variant is what reaches back up to AppShell's
        `h-dvh` <main>. Without a definite height there, this resolves to
        nothing and the grid below collapses — the usual way a data screen
        renders as an invisible strip.

        No max-width on it, deliberately: "as wide as the window allows" is the
        point, and the shell's own padding plus the drawer already bound it.
      */}
      <div className={layout === 'fill' ? 'flex h-full w-full flex-col' : 'mx-auto w-full max-w-4xl'}>
        {backTo ? <BackLink {...backTo} /> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        {/*
          `min-h-0` again: the body is a flex child, and the default
          `min-height: auto` would let it grow to its content and push the
          scrollbar back out to the page.
        */}
        <div className={layout === 'fill' ? 'mt-6 min-h-0 flex-1' : 'mt-8'}>{children}</div>
      </div>
    </FeatureGate>
  );
}

/**
 * Why the page is not being shown, in the terms the reader can act on.
 *
 * The module already distinguishes these — see `denialReason` in check.ts — and
 * a flat "you do not have access" throws the distinction away at the one moment
 * it decides what someone does next. "Ask an administrator" and "upgrade your
 * plan" are different errands, and sending someone on the wrong one wastes a
 * support ticket.
 */
function AdminDenied({
  title,
  reason,
  backTo,
}: {
  title: string;
  reason: DenialReason | undefined;
  backTo?: { href: string; label: string } | undefined;
}) {
  /*
   * The wording lives in `FeatureDenied`, shared with the app's catch-all.
   * This adds only what is local to a module page: the back link.
   */
  return <FeatureDenied title={title} reason={reason} header={backTo ? <BackLink {...backTo} /> : undefined} />;
}

/**
 * A page whose screen is not built yet.
 *
 * Visible rather than an empty <section> with a code comment: a heading over
 * blank space reads as a page that failed to load, and the first thing anyone
 * does with one is check whether it is broken. Saying what is missing costs one
 * line and answers that.
 */
export function AdminPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * The way back to the list a sub page was opened from.
 *
 * ABOVE the title, not beside it: that is where a reader's eye already goes for
 * "where am I and how do I leave", and putting it there keeps it clear of the
 * form actions further down, which do a different job.
 *
 * A plain `<a>`, not next/link — this package must not depend on Next, since a
 * NestJS app imports it too. A full navigation to an admin page costs nothing
 * anyone will notice.
 */
function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="-ml-1 mb-3 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/*
       * Inline rather than from an icon package: this module has no icon
       * dependency and one chevron is not worth starting one — the same call
       * `module-auth` made for its password reveal. The path is lucide's
       * `chevron-left`, so it matches an app that does use lucide.
       */}
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
      {/* "Back to Features", not a bare "Back" — a link that names its
          destination tells you where you will land without having to remember
          how you got here. */}
      Back to {label}
    </a>
  );
}
