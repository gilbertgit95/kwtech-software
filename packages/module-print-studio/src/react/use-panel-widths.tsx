'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { STUDIO_PANELS, type StudioPanelKey } from './view/panel-width.js';

type Widths = Readonly<Partial<Record<StudioPanelKey, number>>>;

const PanelWidths = createContext<{ widths: Widths; set: (key: StudioPanelKey, width: number) => void } | null>(null);

/**
 * The side panels' widths for as long as the studio is open (the operator,
 * 2026-11-03), so a width dragged on the Print screen is still there after a
 * visit to Layouts and back, and the editor opened again keeps its columns.
 *
 * ⚠ IN MEMORY ONLY. The studio writes nothing to browser storage
 * (`test/web-module.test.ts`), so a reload starts from the defaults. The point
 * of sale remembers its widths in the browser; this studio deliberately does
 * not.
 */
export function StudioPanelWidthsProvider({ children }: { children: ReactNode }) {
  const [widths, setWidths] = useState<Widths>({});
  const set = useCallback((key: StudioPanelKey, width: number) => {
    setWidths((current) => (current[key] === width ? current : { ...current, [key]: width }));
  }, []);
  const value = useMemo(() => ({ widths, set }), [widths, set]);
  return <PanelWidths.Provider value={value}>{children}</PanelWidths.Provider>;
}

/**
 * One panel's width, and how to change it. Outside the provider (a test, or a
 * screen rendered by itself) it is held by the caller alone.
 */
export function usePanelWidth(key: StudioPanelKey): [number, (width: number) => void] {
  const shared = useContext(PanelWidths);
  const rules = STUDIO_PANELS[key];
  const [own, setOwn] = useState(rules.bounds.default);
  const width = shared ? (shared.widths[key] ?? rules.bounds.default) : own;
  const set = useCallback(
    (next: number) => {
      const clamped = rules.clamp(next);
      if (shared) shared.set(key, clamped);
      else setOwn(clamped);
    },
    [shared, key, rules],
  );
  return [width, set];
}
