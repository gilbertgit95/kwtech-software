'use client';

import { createContext, type ReactNode, useContext } from 'react';

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
}

const NO_SECTION: MobileSectionState = { section: null, open: () => {} };

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
