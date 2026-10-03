'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { cn } from './utils.js';

/** The drawer's Previous and Next: what each opens (null: nothing that way) and where the open row sits. */
export interface ListDrawerStep {
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  /** "3 of 20"; null when the open one is not in the list. */
  position: string | null;
}

const NO_STEP: ListDrawerStep = { onPrevious: null, onNext: null, position: null };

/**
 * A list, and the one opened from it in a DRAWER over the list's right side
 * (the operator, 2026-10-03): a view opens on its list alone, at full width,
 * and a row slides its detail in. First the point of sale's; shared here when
 * the books took it too (orders, items, customers; investors, loans).
 *
 * The drawer closes by its Close button, by a press outside it, and by Esc;
 * Previous and Next walk the list without closing it.
 *
 * ⚠ INSIDE THIS PANEL, NOT THE VIEWPORT (`absolute`, not `fixed` or a modal
 * `<dialog>`): on the Apps page an app may be one cell of a grid, and a
 * drawer over the whole window would cover the apps beside it. The sub-app
 * contract is that an app stays inside its box.
 */
export function ListDrawer({
  list,
  detail,
  onClose,
  label,
  step = NO_STEP,
}: {
  list: ReactNode;
  /** Null: nothing is open, and there is no drawer. */
  detail: ReactNode | null;
  onClose: () => void;
  /** What the drawer holds, as its accessible name and in its buttons: "order", "item", "customer". */
  label: string;
  /** Omitted: the drawer has no Previous and Next that go anywhere. */
  step?: ListDrawerStep;
}) {
  const open = detail !== null;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* `inert` while the drawer is open: Tab must not wander into rows hidden behind the backdrop. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2" inert={open}>
        {list}
      </div>
      {open ? (
        <Drawer label={label} step={step} onClose={onClose}>
          {detail}
        </Drawer>
      ) : null}
    </div>
  );
}

/** The header's buttons: small and quiet, so the detail under them is what is read. */
const DRAWER_BUTTON = cn(
  'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
  'hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);

/** How long the drawer takes to slide in. */
const DRAWER_SLIDE_MS = 200;

/** Mounted only while something is open, so its effects are the drawer's opening and closing. */
function Drawer({
  label,
  step,
  onClose,
  children,
}: {
  label: string;
  step: ListDrawerStep;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // The slide, started before the first paint so the drawer is never seen at
  // rest and then jumped off-screen. An animation on `transform` and `opacity`
  // alone, which the browser runs off the main thread: the detail is loading
  // and rendering during these 200ms, and a transition driven by style changes
  // stuttered behind that work (the operator, 2026-10-03).
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timing = { duration: DRAWER_SLIDE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
    ref.current?.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], timing);
    backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], timing);
  }, []);

  // Focus has a home (D20): into the drawer when it opens, unless the detail
  // took it itself (a form's first field), and back to the row that opened it
  // when it closes — so ↑ ↓ carry on from where the person was.
  useEffect(() => {
    const opener = document.activeElement;
    // ⚠ `preventScroll`: the drawer is still off the right edge when it takes focus, and the browser would scroll the panel sideways to show it — the slide then started from the wrong place.
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true });
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    // ⚠ Its own clipping layer: the drawer starts off the right edge, and unclipped that would give the panel a sideways scrollbar for the length of the slide.
    // `clip`, not `hidden`: a hidden box can still be scrolled by focus landing on a field inside the off-screen drawer.
    <div className="absolute inset-0 z-10 overflow-clip">
      {/*
       * ⚠ BLACK, not the theme's foreground: on a dark theme the foreground is
       * light, so a foreground scrim LIT the list up behind the drawer instead
       * of dimming it (the operator, 2026-10-03). `ConfirmDialog`'s backdrop is
       * black for the same reason.
       *
       * Lighter on a light theme (20%) than a modal's 50%: a modal dims the
       * whole window evenly, but this dims one panel in a page that stays
       * bright, and at 50% that panel was the darkest, loudest thing on the
       * screen (the operator, 2026-10-03). A dark theme keeps 50%: black on
       * near-black needs that much to show at all.
       */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a press outside the drawer closes it; the keyboard equivalents are Esc and the Close button. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: as above. */}
      <div ref={backdropRef} className="absolute inset-0 bg-black/20 dark:bg-black/50" onClick={onClose} />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`The ${label}`}
        tabIndex={-1}
        className={cn(
          // `card`, the raised surface: the drawer is the thing in front, on either theme.
          'absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-border bg-card text-card-foreground shadow-2xl',
          'focus-visible:outline-none',
        )}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          // ⚠ Esc inside a dialog opened FROM the drawer (refund, void) closes that dialog, not the drawer under it.
          if (event.target instanceof Element && event.target.closest('dialog')) return;
          // Prevented, so the app's own Esc (back to its first section) does not also fire: one Esc, one step back.
          event.preventDefault();
          onClose();
        }}
      >
        <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
          <button
            type="button"
            className={DRAWER_BUTTON}
            disabled={step.onPrevious === null}
            aria-label={`Previous ${label}`}
            onClick={() => step.onPrevious?.()}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Previous
          </button>
          <button
            type="button"
            className={DRAWER_BUTTON}
            disabled={step.onNext === null}
            aria-label={`Next ${label}`}
            onClick={() => step.onNext?.()}
          >
            Next
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
          {step.position ? (
            <span className="px-1 text-xs text-muted-foreground tabular-nums">{step.position}</span>
          ) : null}
          <button type="button" className={cn(DRAWER_BUTTON, 'ml-auto')} onClick={onClose}>
            <X aria-hidden="true" className="size-4" />
            Close
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">{children}</div>
      </aside>
    </div>
  );
}
