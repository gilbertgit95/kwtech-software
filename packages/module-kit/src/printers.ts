/**
 * The contract for printing on one of a workspace's own printers — a printer
 * on a shop computer paired through the print agent — from ANY module.
 *
 * ## Why it is here
 *
 * A module that makes a PDF (the print studio, the POS's price list) wants it
 * on paper, and putting it there is `module-print`'s work. A module may not
 * import a module (PLAN §9), so each would declare a port of its own; two did,
 * as copies, before this moved here (PLAN §13, 2026-10-17). Now there is ONE
 * port: a module asks for it with `usePrinters(scope)` from
 * `@kwtech/module-kit/react`, shows `PrinterMenu` from `@kwtech/web-ui/react`,
 * and the web app binds `module-print`'s `createPrintTarget()` once, in a
 * client file, for all of them:
 *
 *   <PrinterProvider printer={createPrintTarget()}>…</PrinterProvider>
 *
 * ⚠ UNBOUND MEANS OFF. With no provider, or no printer this person may use,
 * a module offers what it offered before: a download, the browser's print.
 *
 * ⚠ THE CALLER NEVER NAMES A PAPER. It says how large its page is, and the
 * binder finds the printer's paper of that size, or refuses with a sentence.
 *
 * Types only, so the root entry point stays runtime-free.
 */

/** The workspace whose printers these are. */
export interface PrinterScope {
  organizationId: string;
  workspaceId: string;
}

/** One printer a person may choose. */
export interface PrinterChoice {
  id: string;
  name: string;
  /** The computer it is on, as the workspace named it. */
  computer: string;
  /** Why it cannot be printed on right now, or null when it can. */
  blocked: string | null;
  /** What a person may choose for one print on it: paper type, quality, whatever the binder offers. May be empty. */
  settings: PrinterSetting[];
}

/**
 * One thing to choose before printing, as a list to pick from.
 *
 * ⚠ THE CALLER DOES NOT KNOW WHAT IT IS. It shows the label and the options,
 * and hands back the key with the id chosen. What a "paper type" means, and
 * which ones a printer has, is the binder's; so is a setting added later.
 */
export interface PrinterSetting {
  key: string;
  label: string;
  options: { id: string; label: string }[];
  /** What the printer is set to now, to start on. Null: not known. */
  initial: string | null;
}

/** One PDF for one printer. The page's size as oriented, in hundredths of a millimetre. */
export interface PrinterJob {
  printerId: string;
  pdf: Uint8Array;
  width: number;
  height: number;
  /** The choices made, by the setting's key. One left out stays as the printer is set. */
  settings?: Readonly<Record<string, string>>;
}

export interface PrinterOutcome {
  /** True only when the printer's computer took the job. */
  sent: boolean;
  /** A sentence for the person, either way. */
  message: string;
}

export interface PrinterPort {
  /** The printers to offer. Empty when there are none, or this person may not use them. */
  printers(scope: PrinterScope): Promise<PrinterChoice[]>;
  /** Print one PDF. Never throws: a refusal is an outcome with its sentence. `onStatus` hears each step. */
  print(scope: PrinterScope, job: PrinterJob, onStatus?: (text: string) => void): Promise<PrinterOutcome>;
}
