'use client';

import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react';

/**
 * Which SECTION of a phone screen is open — Sell, Orders, Customers — when
 * the screen declared `sections` (issue #22).
 *
 * The phone frame draws the sections as a strip under its top bar and owns
 * which one is open, so every app's sections look and behave the same and
 * survive a reload (`?section=`). The screen only reads the answer and draws
 * that section. A context, not a prop: the screen is rendered once on the
 * server, and the open section changes in the browser.
 */
export interface MobileSectionState {
  /** The open section's key. Null: the screen declared none, or none is open — show your first. */
  section: string | null;
  /** Opens another of this screen's sections — from inside it, as a till's "View orders" would. */
  open: (key: string) => void;
  /**
   * Puts a count on one of this screen's section chips ("Cashier 3"), or
   * clears it with null (issue #69). Prefer `useMobileSectionBadge`, which
   * reports on change and clears when the screen goes.
   */
  setBadge: (section: string, count: number | null) => void;
}

const NO_SECTION: MobileSectionState = { section: null, open: () => {}, setBadge: () => {} };

const MobileSectionContext = createContext<MobileSectionState>(NO_SECTION);

export interface MobileSectionProviderProps {
  value: MobileSectionState;
  children: ReactNode;
}

export function MobileSectionProvider({ value, children }: MobileSectionProviderProps) {
  return <MobileSectionContext.Provider value={value}>{children}</MobileSectionContext.Provider>;
}

/**
 * This screen's open section.
 *
 * OUTSIDE A PROVIDER (a test, the desktop Apps page) it is null and `open`
 * does nothing, so a component shared with the desktop draws its own default.
 */
export function useMobileSection(): MobileSectionState {
  return useContext(MobileSectionContext);
}

/**
 * Shows `count` on one of this screen's section chips while the screen is
 * mounted, and clears it when it goes (issue #69). Null, or zero, shows none.
 * The count comes from data the screen already holds live, so it changes with
 * it; the frame keeps it only while the screen reports it.
 *
 * OUTSIDE A PROVIDER (the desktop Apps page, a test) it does nothing.
 */
export function useMobileSectionBadge(section: string, count: number | null): void {
  const { setBadge } = useMobileSection();
  // Through a ref: the frame builds its context value on each render, and depending on it would report in a loop.
  const report = useRef(setBadge);
  report.current = setBadge;
  useEffect(() => {
    report.current(section, count);
  }, [section, count]);
  useEffect(() => () => report.current(section, null), [section]);
}
