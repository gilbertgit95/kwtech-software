'use client';

import { cn, LIST_ITEM } from '@kwtech/web-ui/react';
import { ChevronLeft, ChevronRight, type LucideIcon, X } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import type { StatusTone } from '../view/manage.js';
import { buttonClass, INPUT_CLASS } from './controls.js';

/*
 * The app's shared frame (D23): the section bar, a section's tabs, a list with its detail drawer,
 * a status chip, and the one alert. Laid out by the PANEL's width (container
 * queries), never the viewport's: a grid cell on the Apps page is narrow on a
 * wide screen.
 */

/** The warning-toned count beside a section or a tab: what still needs somebody. */
function CountBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <span className="rounded-full bg-status-warning px-1.5 text-[10px] text-status-warning-foreground tabular-nums">
      {count}
    </span>
  );
}

/**
 * The section bar (D23): the app's MAIN tabs. Drawn as an underlined bar
 * across the whole panel, with an icon each, so it reads as the level above
 * `Tabs` below — two rows of identical buttons gave no hint which row was the
 * section and which was the filter inside it (the operator, 2026-10-01).
 *
 * A narrow panel folds the bar into a menu (D23), on the same rule line.
 */
export function SectionBar<K extends string>({
  sections,
  current,
  onChange,
  label,
  children,
}: {
  sections: readonly { key: K; label: string; icon: LucideIcon; badge?: number }[];
  current: K;
  onChange: (key: K) => void;
  /** The nav's accessible name. */
  label: string;
  /** A quiet note at the bar's far end (the "not live" line). */
  children?: ReactNode;
}) {
  return (
    <nav aria-label={label} className="flex min-w-0 items-center gap-3 border-b border-border">
      <label className="pb-2 @xl:hidden">
        <span className="sr-only">Section</span>
        <select
          className={cn(INPUT_CLASS, 'w-auto font-medium')}
          value={current}
          // The options are the sections above, so the value is one of them.
          onChange={(event) => onChange(event.target.value as K)}
        >
          {sections.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
              {entry.badge ? ` (${entry.badge})` : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="hidden flex-wrap items-center gap-1 @xl:flex">
        {sections.map((entry) => {
          const active = entry.key === current;
          return (
            <button
              key={entry.key}
              type="button"
              aria-current={active ? 'page' : undefined}
              className={cn(
                // -mb-px: the tab's own underline sits ON the bar's rule, not above it.
                '-mb-px inline-flex h-10 items-center gap-2 rounded-t-md border-b-2 px-3 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent/50 hover:text-foreground',
              )}
              onClick={() => onChange(entry.key)}
            >
              <entry.icon aria-hidden="true" className={cn('size-4', active ? 'text-primary' : null)} />
              {entry.label}
              <CountBadge count={entry.badge} />
            </button>
          );
        })}
      </div>
      {children ? <span className="ml-auto pb-2 text-xs text-muted-foreground @xl:pb-0">{children}</span> : null}
    </nav>
  );
}

/**
 * A section's SUB tabs, as a segmented control: small pills in one muted
 * track, hugging their content — deliberately unlike `SectionBar` above, so
 * the two levels cannot be mistaken for each other.
 *
 * `aria-pressed` buttons in a labelled fieldset rather than a tablist: each tab reloads a list, it hides nothing.
 */
export function Tabs<K extends string>({
  tabs,
  current,
  onChange,
  label,
}: {
  tabs: readonly { key: K; label: string; badge?: number }[];
  current: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <fieldset className="m-0 flex w-fit min-w-0 max-w-full shrink-0 flex-wrap gap-0.5 rounded-lg border-0 bg-muted p-0.5">
      <legend className="sr-only">{label}</legend>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={tab.key === current}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            tab.key === current
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          <CountBadge count={tab.badge} />
        </button>
      ))}
    </fieldset>
  );
}

/** The drawer's Previous and Next: what each opens (null: nothing that way) and where the open row sits. */
export interface DrawerStep {
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  /** "3 of 20"; null when the open one is not in the list. */
  position: string | null;
}

/**
 * A list, and the one opened from it in a DRAWER over the list's right side
 * (the operator, 2026-10-03). Before, the detail sat beside the list in a wide
 * panel and replaced it in a narrow one (D23); now a tab opens on its list
 * alone, at full width, and a row slides its detail in.
 *
 * The drawer closes by its Close button, by a press outside it, and by Esc;
 * Previous and Next walk the list without closing it.
 *
 * ⚠ INSIDE THIS PANEL, NOT THE VIEWPORT (`absolute`, not `fixed` or a modal
 * `<dialog>`): on the Apps page the POS may be one cell of a grid, and a
 * drawer over the whole window would cover the apps beside it. The sub-app
 * contract is that an app stays inside its box.
 */
export function ListDetail({
  list,
  detail,
  onClose,
  label,
  step,
}: {
  list: ReactNode;
  /** Null: nothing is open, and there is no drawer. */
  detail: ReactNode | null;
  onClose: () => void;
  /** What the drawer holds, as its accessible name and in its buttons: "order", "item", "customer". */
  label: string;
  step: DrawerStep;
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
  step: DrawerStep;
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
          // Prevented, so the app's own Esc (back to Sell) does not also fire: one Esc, one step back.
          event.preventDefault();
          onClose();
        }}
      >
        <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            disabled={step.onPrevious === null}
            aria-label={`Previous ${label}`}
            onClick={() => step.onPrevious?.()}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Previous
          </button>
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
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
          <button type="button" className={cn(buttonClass('ghost', 'sm'), 'ml-auto')} onClick={onClose}>
            <X aria-hidden="true" className="size-4" />
            Close
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">{children}</div>
      </aside>
    </div>
  );
}

const TONE_CLASS: Readonly<Record<StatusTone, string>> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-status-success text-status-success-foreground',
  warning: 'bg-status-warning text-status-warning-foreground',
  danger: 'bg-status-error text-status-error-foreground',
  info: 'bg-status-info text-status-info-foreground',
};

export function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', TONE_CLASS[tone])}>{label}</span>
  );
}

/** The section's one alert, dismissible. Says what went wrong in the API's own words. */
export function Alert({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-1.5 text-sm text-destructive"
    >
      {message}
      {onDismiss ? (
        <button type="button" className={buttonClass('ghost', 'sm')} onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

/** A quiet line for an empty list or a list still loading. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-1 py-4 text-sm text-muted-foreground">{children}</p>;
}

/**
 * A list row button: the whole row opens the thing. It is a choice of the list
 * around it (`LIST_KEYS` on the container), so ↑ ↓ reach it and Enter opens it.
 */
export function RowButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      {...LIST_ITEM}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        // ⚠ `relative`: screen-reader-only text in a row (`sr-only`) is absolutely positioned, and without a positioned
        // ancestor inside the scrolling list it does not scroll with it. It sat far down the page instead and gave the
        // whole app a second scrollbar beside the list's own (Customers, whose rows say which contacts are recorded).
        'relative flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-accent' : 'border-border',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
