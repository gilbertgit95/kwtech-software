'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { PrinterChoice, PrinterJob, PrinterOutcome, PrinterPort, PrinterScope } from '../printers.js';

/**
 * The workspace's printers for any module: the port the web app binds
 * (`../printers.ts` says why it is one port, here).
 *
 * ⚠ BOUND THROUGH CONTEXT, NOT A MODULE OPTION. A sub-app's element is made
 * on the server (`module-app-hub`), and an object of functions cannot be
 * passed from there to a client component.
 */
const PrinterContext = createContext<PrinterPort | null>(null);

export interface PrinterProviderProps {
  /** The binder (`module-print`'s `createPrintTarget()`), or null: printing on the workspace's printers is off. */
  printer: PrinterPort | null;
  children: ReactNode;
}

export function PrinterProvider({ printer, children }: PrinterProviderProps) {
  return <PrinterContext.Provider value={printer}>{children}</PrinterContext.Provider>;
}

/** The bound port, or null. Most callers want `usePrinters`. */
export function usePrinter(): PrinterPort | null {
  return useContext(PrinterContext);
}

/** What `usePrinters` hands a screen. */
export interface PrintersState {
  /** The printers to offer. Empty when unbound, when there are none, or when this person may not use them. */
  printers: readonly PrinterChoice[];
  /** Read the list again: when the menu opens, so a computer switched on since shows without leaving the page. */
  refresh: () => void;
  /**
   * Print one PDF, then read the list again. Never throws: unbound, a
   * refusal, or a failure is an outcome with its sentence.
   */
  print: (job: PrinterJob, onStatus?: (text: string) => void) => Promise<PrinterOutcome>;
}

/** The sentence when nothing is bound, should a screen print without having shown a printer. */
const UNBOUND: PrinterOutcome = { sent: false, message: 'Printing on the workspace’s printers is not set up here.' };

/**
 * The workspace's printers for one screen: read when it appears, again on
 * `refresh()` and after each print.
 *
 * ⚠ `scope` IS A DEPENDENCY: pass a stable object (from state or `useMemo`),
 * or the list is read on every render.
 */
export function usePrinters(scope: PrinterScope): PrintersState {
  const port = usePrinter();
  const [printers, setPrinters] = useState<readonly PrinterChoice[]>([]);
  const [reads, setReads] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reads` is the "read again" signal, not a value used.
  useEffect(() => {
    if (!port) {
      setPrinters([]);
      return;
    }
    let current = true;
    port.printers(scope).then(
      (found) => {
        if (current) setPrinters(found);
      },
      // The port promises not to throw; one that does still leaves the screen as it was without printers.
      () => {
        if (current) setPrinters([]);
      },
    );
    return () => {
      current = false;
    };
  }, [port, scope, reads]);

  const refresh = useCallback(() => setReads((count) => count + 1), []);
  const print = useCallback(
    async (job: PrinterJob, onStatus?: (text: string) => void): Promise<PrinterOutcome> => {
      if (!port) return UNBOUND;
      try {
        return await port.print(scope, job, onStatus);
      } catch (caught) {
        return { sent: false, message: caught instanceof Error ? caught.message : 'Could not reach the printer.' };
      } finally {
        refresh();
      }
    },
    [port, scope, refresh],
  );
  return { printers, refresh, print };
}
