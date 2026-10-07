'use client';

import { createContext, type ReactNode, useContext } from 'react';
import type { StudioScopeView } from './studio-client.js';

/**
 * The studio's way onto a printer it does not own: a PORT the web app binds
 * (PRINT-STUDIO-PLAN §10).
 *
 * The studio makes a PDF. Putting it on a shop's printer is another module's
 * work (`module-print` and the print agent), and a module may not import a
 * module (PLAN §9). So the studio says here what it needs, and the app hands
 * it something that does it:
 *
 *   // a client file of the app
 *   <StudioPrinterProvider printer={createPrintTarget()}>…</StudioPrinterProvider>
 *
 * ⚠ UNBOUND MEANS OFF. With no provider, or none of the workspace's printers
 * to offer, the studio is exactly what it was: Download, and the browser's
 * own print window. Bound, a third button — Printers — sits between the two.
 *
 * ⚠ BOUND THROUGH CONTEXT, NOT AN OPTION OF `studioWebModule`. A sub-app's
 * element is made on the server (`module-app-hub`), and an object of
 * functions cannot be passed from there to a client component.
 *
 * ⚠ THIS IS THE ONE WAY A RESULT LEAVES THE BROWSER, and only when a person
 * presses Print with a printer chosen. It goes to the shop's own computer to
 * be printed and is kept nowhere on the way; what the port does with it is
 * the binder's contract (PRINT-STUDIO-PLAN decision 8, PLAN §13 2026-10-07).
 */

/** One printer a person may choose. */
export interface StudioPrinterChoice {
  id: string;
  name: string;
  /** The computer it is on, as the workspace named it. */
  computer: string;
  /** Why it cannot be printed on right now, or null when it can. */
  blocked: string | null;
  /** What a person may choose for one print on it: paper type, quality, whatever the binder offers. May be empty. */
  settings: StudioPrinterSetting[];
}

/**
 * One thing to choose before printing, as a list to pick from.
 *
 * ⚠ THE STUDIO DOES NOT KNOW WHAT IT IS. It shows the label and the options,
 * and hands back the key with the id chosen. What a "paper type" means, and
 * which ones a printer has, is the binder's; so is a setting added later.
 */
export interface StudioPrinterSetting {
  key: string;
  label: string;
  options: { id: string; label: string }[];
  /** What the printer is set to now, to start on. Null: not known. */
  initial: string | null;
}

/** One result for one printer. The sheet's size as oriented, in the studio's units (hundredths of a millimetre). */
export interface StudioPrinterJob {
  printerId: string;
  pdf: Uint8Array;
  width: number;
  height: number;
  /** The choices made, by the setting's key. One left out stays as the printer is set. */
  settings?: Readonly<Record<string, string>>;
}

export interface StudioPrinterOutcome {
  /** True only when the printer's computer took the job. */
  sent: boolean;
  /** A sentence for the person, either way. */
  message: string;
}

export interface StudioPrinterPort {
  /** The printers to offer. Empty when there are none, or this person may not use them. */
  printers(scope: StudioScopeView): Promise<StudioPrinterChoice[]>;
  /** Print one result. Never throws: a refusal is an outcome with its sentence. `onStatus` hears each step. */
  print(
    scope: StudioScopeView,
    job: StudioPrinterJob,
    onStatus?: (text: string) => void,
  ): Promise<StudioPrinterOutcome>;
}

const StudioPrinterContext = createContext<StudioPrinterPort | null>(null);

export function StudioPrinterProvider({
  printer,
  children,
}: {
  printer: StudioPrinterPort | null;
  children: ReactNode;
}) {
  return <StudioPrinterContext.Provider value={printer}>{children}</StudioPrinterContext.Provider>;
}

/** The bound port, or null: Download and the browser's print window only. */
export function useStudioPrinter(): StudioPrinterPort | null {
  return useContext(StudioPrinterContext);
}
