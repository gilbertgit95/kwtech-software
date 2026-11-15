'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PrinterChoice,
  PrinterJob,
  PrinterOutcome,
  PrinterPort,
  PrinterReceiptLine,
  PrinterScope,
  ReceiptPrinting,
} from '../printers.js';

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
  // One object while nothing changes: a screen's callbacks and effects that depend on it stay put.
  return useMemo(() => ({ printers, refresh, print }), [printers, refresh, print]);
}

/** What `useReceiptPrinters` hands a screen. */
export interface ReceiptPrintersState {
  /** False when nothing is bound: the screen offers the browser's print, as it did before. */
  bound: boolean;
  /** The receipt printers and the pick. Null until first read. */
  printing: ReceiptPrinting | null;
  /** Read again: when the menu opens, so a computer switched on since shows. */
  refresh: () => void;
  /**
   * Read now and hand back what was read (also kept as `printing`): what a
   * tap decides with. ⚠ A list read minutes ago would send a receipt to a
   * computer switched off since. Null when nothing is bound.
   */
  read: () => Promise<ReceiptPrinting | null>;
  /** This device's receipt printer from now on (null: none), then read again. */
  choose: (printerId: string | null) => void;
  /** A receipt on a receipt printer. Never throws. */
  print: (
    printerId: string,
    lines: readonly PrinterReceiptLine[],
    onStatus?: (text: string) => void,
  ) => Promise<PrinterOutcome>;
  /** A receipt as a narrow page on a document printer: the fallback. Never throws. */
  printAsPage: (
    printerId: string,
    lines: readonly PrinterReceiptLine[],
    onStatus?: (text: string) => void,
  ) => Promise<PrinterOutcome>;
}

/**
 * The workspace's receipt printers for one screen (#144, R5), with the one a
 * receipt goes to on this device: read when it appears, on `refresh()`, after
 * a choice and after each print.
 *
 * ⚠ `scope` IS A DEPENDENCY: pass a stable object, as for `usePrinters`.
 */
export function useReceiptPrinters(scope: PrinterScope): ReceiptPrintersState {
  const port = usePrinter();
  const [printing, setPrinting] = useState<ReceiptPrinting | null>(null);
  const [reads, setReads] = useState(0);
  /**
   * ⚠ THE NEWEST READ WINS. A tap's `read()` and a refresh can be on the way
   * at once; the one STARTED last is kept, whichever answers last, so an
   * older answer never puts back a printer list that is no longer true.
   */
  const latest = useRef(0);
  const unreadable: ReceiptPrinting = {
    printers: [],
    pick: { kind: 'ask', reason: 'The receipt printers could not be read.' },
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reads` is the "read again" signal, not a value used.
  useEffect(() => {
    if (!port) {
      setPrinting(null);
      return;
    }
    latest.current += 1;
    const mine = latest.current;
    let current = true;
    const keep = (found: ReceiptPrinting) => {
      if (current && mine === latest.current) setPrinting(found);
    };
    port.receipts(scope).then(keep, () => keep(unreadable));
    return () => {
      current = false;
    };
  }, [port, scope, reads]);

  const refresh = useCallback(() => setReads((count) => count + 1), []);
  const read = useCallback(async (): Promise<ReceiptPrinting | null> => {
    if (!port) return null;
    latest.current += 1;
    const mine = latest.current;
    let found: ReceiptPrinting;
    try {
      found = await port.receipts(scope);
    } catch {
      found = { printers: [], pick: { kind: 'ask', reason: 'The receipt printers could not be read.' } };
    }
    // Handed back either way: the tap decides on what IT read. Shown only if nothing newer started since.
    if (mine === latest.current) setPrinting(found);
    return found;
  }, [port, scope]);
  const choose = useCallback(
    (printerId: string | null) => {
      port?.chooseReceiptPrinter(scope, printerId);
      refresh();
    },
    [port, scope, refresh],
  );
  const send = useCallback(
    async (
      how: 'printReceipt' | 'printReceiptAsPage',
      printerId: string,
      lines: readonly PrinterReceiptLine[],
      onStatus?: (text: string) => void,
    ): Promise<PrinterOutcome> => {
      if (!port) return UNBOUND;
      try {
        return await port[how](scope, { printerId, lines }, onStatus);
      } catch (caught) {
        return { sent: false, message: caught instanceof Error ? caught.message : 'Could not reach the printer.' };
      } finally {
        refresh();
      }
    },
    [port, scope, refresh],
  );
  const print = useCallback(
    (printerId: string, lines: readonly PrinterReceiptLine[], onStatus?: (text: string) => void) =>
      send('printReceipt', printerId, lines, onStatus),
    [send],
  );
  const printAsPage = useCallback(
    (printerId: string, lines: readonly PrinterReceiptLine[], onStatus?: (text: string) => void) =>
      send('printReceiptAsPage', printerId, lines, onStatus),
    [send],
  );
  const bound = port !== null;
  return useMemo(
    () => ({ bound, printing, refresh, read, choose, print, printAsPage }),
    [bound, printing, refresh, read, choose, print, printAsPage],
  );
}
