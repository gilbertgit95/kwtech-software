'use client';

import { paperForSize } from '../domain/printers.js';
import { checkReceipt, encodeReceipt, type ReceiptLine } from '../domain/receipt.js';
import { receiptPagePdf } from '../domain/receipt-page.js';
import {
  pickReceiptPrinter,
  type ReceiptPickPlan,
  receiptPrinterName,
  receiptProfileOf,
} from '../domain/receipt-printers.js';
import {
  createPrintClient,
  type PrintAgentView,
  type PrintClient,
  type PrintJobRequest,
  type PrintPrinterView,
  type PrintScopeView,
} from './print-client.js';
import { printThroughAgent } from './print-flow.js';
import { cannotPrintReason, defaultRulerPaper, jobStatusText, paperSizeText } from './view.js';

/**
 * This module as somewhere ANOTHER module can print to: the printers a person
 * may choose, and "put this PDF on that one".
 *
 * ## Why it exists
 *
 * The print studio, the POS's price list and any module after them make a
 * PDF and want it on paper. A module may not import a module (PLAN §9), so
 * `module-kit` declares ONE port for all of them (`PrinterPort`, read with
 * `usePrinters`) and the web app binds this to it, in a client file:
 *
 *   <PrinterProvider printer={PRINT_TARGET}>   // const PRINT_TARGET = createPrintTarget()
 *
 * The shapes below are this module's own. They fit module-kit's port because
 * the two were written to, and the app's compiler checks that they still do.
 *
 * ⚠ THE CALLER NEVER NAMES A PAPER. It says how large its page is, and the
 * paper is found among those the printer reported (`paperForSize`). A page
 * with no paper of its size is refused here, with a sentence, before a job is
 * opened.
 *
 * ⚠ NO FILE IS KEPT. The file is passed to the job and let go, and no list
 * is held between calls. The one thing written to the browser is which
 * receipt printer this device prints on, by id (`BROWSER_RECEIPT_CHOICE`).
 */

/** One printer a person may choose. */
export interface PrintTargetPrinter {
  id: string;
  /** The queue's name on its computer. */
  name: string;
  /** The paired computer it is on, as it was named in the web app. */
  computer: string;
  /** Why it cannot be printed on right now, or null when it can. */
  blocked: string | null;
  /** What a person may choose for one print on this printer. Empty: nothing, and it prints as it is set. */
  settings: PrintTargetSetting[];
}

/**
 * One thing to choose before printing, as a list to pick from. The caller
 * shows `label` and the options and hands back `key` with the id chosen; it
 * never learns what the setting IS, so a third one costs it nothing.
 */
export interface PrintTargetSetting {
  key: string;
  label: string;
  options: { id: string; label: string }[];
  /** The printer's own current choice, to start on. Null: not known. */
  initial: string | null;
}

/** The settings a printer offers, in the order a person meets them: what is in the tray, then how to print on it. */
export function targetSettings(
  printer: Pick<PrintPrinterView, 'mediaTypes' | 'mediaType' | 'qualities' | 'quality'>,
): PrintTargetSetting[] {
  return [
    { key: 'mediaType', label: 'Paper type', options: printer.mediaTypes, initial: printer.mediaType },
    { key: 'quality', label: 'Quality', options: printer.qualities, initial: printer.quality },
  ].filter((setting) => setting.options.length > 0);
}

/** One PDF for one printer. Lengths in hundredths of a millimetre, the page as it is oriented. */
export interface PrintTargetJob {
  printerId: string;
  pdf: Uint8Array;
  width: number;
  height: number;
  /** A choice for any of the printer's `settings`, by key. One left out stays as the printer is set. */
  settings?: Readonly<Record<string, string>>;
}

export interface PrintTargetOutcome {
  /** True only when the computer said its operating system took the job. */
  sent: boolean;
  /** A sentence for the person, either way. */
  message: string;
}

/** One receipt printer, as a cashier picks it (#144, R5). */
export interface PrintTargetReceiptPrinter {
  id: string;
  /** Its name for its place, else its name on the computer. */
  name: string;
  computer: string;
  paperWidth: 58 | 80;
  isDefault: boolean;
  blocked: string | null;
  /** When its computer was last heard from, while offline (ISO). */
  offlineSince: string | null;
}

/** The receipt printers, and where a receipt goes on this device. */
export interface PrintTargetReceipts {
  printers: PrintTargetReceiptPrinter[];
  pick: ReceiptPickPlan;
}

/** One receipt, for a receipt printer or (as a page) a document printer. */
export interface PrintTargetReceiptJob {
  printerId: string;
  lines: readonly ReceiptLine[];
}

/**
 * Where this device keeps its receipt printer: one per workspace, in this
 * browser. The seam the tests replace.
 *
 * ⚠ A CONVENIENCE, NOT A RECORD. Storage a private window or a cleared
 * browser does not have is "no choice", and the receipt goes to the
 * workspace's default, as on a new device.
 */
export interface DeviceReceiptChoice {
  read(workspaceId: string): string | null;
  write(workspaceId: string, printerId: string | null): void;
}

const DEVICE_CHOICE_KEY = 'kwtech:print-receipt-printer:';

/** This browser's `localStorage`, every read and write tolerant of having none. */
export const BROWSER_RECEIPT_CHOICE: DeviceReceiptChoice = {
  read(workspaceId) {
    try {
      return globalThis.localStorage?.getItem(DEVICE_CHOICE_KEY + workspaceId) ?? null;
    } catch {
      return null;
    }
  },
  write(workspaceId, printerId) {
    try {
      if (printerId === null) globalThis.localStorage?.removeItem(DEVICE_CHOICE_KEY + workspaceId);
      else globalThis.localStorage?.setItem(DEVICE_CHOICE_KEY + workspaceId, printerId);
    } catch {
      // No storage here (a private window, blocked site data): the choice lasts until the page reloads, as no choice.
    }
  },
};

export interface PrintTarget {
  /**
   * The workspace's document printers, gone ones and receipt printers left
   * out (a receipt printer prints receipts only, #144).
   *
   * ⚠ EMPTY FOR SOMEBODY WHO MAY NOT SEE THEM, and when they cannot be read.
   * The caller offers what it offered before this existed; the Printers page
   * is where a refusal is explained.
   */
  printers(scope: PrintScopeView): Promise<PrintTargetPrinter[]>;
  /** Print one PDF. Never throws: a refusal is an outcome with its sentence. `onStatus` hears each step. */
  print(scope: PrintScopeView, job: PrintTargetJob, onStatus?: (text: string) => void): Promise<PrintTargetOutcome>;
  /**
   * The receipt printers, gone ones left out, and where a receipt goes on
   * this device (`pickReceiptPrinter`). None, with the reason to ask, for
   * somebody who may not see them or when they cannot be read.
   */
  receipts(scope: PrintScopeView): Promise<PrintTargetReceipts>;
  /** This device's receipt printer, or (null) none. */
  chooseReceiptPrinter(scope: PrintScopeView, printerId: string | null): void;
  /** A receipt as text, on a receipt printer. Never throws. */
  printReceipt(
    scope: PrintScopeView,
    job: PrintTargetReceiptJob,
    onStatus?: (text: string) => void,
  ): Promise<PrintTargetOutcome>;
  /** A receipt as a narrow column on a document printer's paper (`receiptPagePdf`). Never throws. */
  printReceiptAsPage(
    scope: PrintScopeView,
    job: PrintTargetReceiptJob,
    onStatus?: (text: string) => void,
  ): Promise<PrintTargetOutcome>;
}

export interface PrintTargetOptions {
  /** The API client. Made on first use when left out, so this can be called where there is no browser yet. */
  client?: PrintClient;
  /** The seam the tests replace: how the wait between two reads of a job is spent. */
  wait?: (ms: number) => Promise<void>;
  /** Where this device's receipt printer is kept. Left out: this browser's storage. */
  deviceChoice?: DeviceReceiptChoice;
}

/** The sentence for a receipt that cannot be printed at all: too long, or nothing on it. */
const RECEIPT_REFUSED = 'This receipt is too long to print, or has nothing on it.';

export function createPrintTarget(options: PrintTargetOptions = {}): PrintTarget {
  let made: PrintClient | null = options.client ?? null;
  const client = () => {
    made ??= createPrintClient();
    return made;
  };
  const device = options.deviceChoice ?? BROWSER_RECEIPT_CHOICE;

  /** The printer and its computer, read again, never remembered: the printer as it stands now. */
  async function find(
    scope: PrintScopeView,
    printerId: string,
  ): Promise<{ agent: PrintAgentView; printer: PrintPrinterView } | string> {
    const agents = await client().agents(scope);
    const agent = agents.find((one) => one.printers.some((printer) => printer.id === printerId));
    const printer = agent?.printers.find((one) => one.id === printerId);
    if (!agent || !printer) return 'That printer is no longer paired here.';
    return cannotPrintReason(agent, printer) ?? { agent, printer };
  }

  /** One job through the agent, to its end, as an outcome. */
  async function send(
    scope: PrintScopeView,
    request: PrintJobRequest,
    bytes: Uint8Array,
    onStatus: (text: string) => void,
  ): Promise<PrintTargetOutcome> {
    const ended = await printThroughAgent(
      client(),
      scope,
      request,
      bytes,
      (state) => onStatus(jobStatusText(state).label),
      options.wait,
    );
    const said = jobStatusText(ended);
    if (!said.ended) {
      return { sent: false, message: 'The computer has not said how the printing went. Look at the printer.' };
    }
    return { sent: ended?.status === 'printed', message: said.label };
  }

  /** A failure as an outcome: the API's sentence is for a reader. */
  const failed = (caught: unknown, fallback: string): PrintTargetOutcome => ({
    sent: false,
    message: caught instanceof Error ? caught.message : fallback,
  });

  return {
    async printers(scope) {
      try {
        const agents = await client().agents(scope);
        return agents.flatMap((agent) =>
          agent.printers
            // ⚠ Receipt printers print receipts only (#144): a PDF there would be refused, or garbage on a roll.
            .filter((printer) => !printer.gone && printer.receipt === null)
            .map((printer) => ({
              id: printer.id,
              name: printer.name,
              computer: agent.name,
              blocked: cannotPrintReason(agent, printer),
              settings: targetSettings(printer),
            })),
        );
      } catch {
        return [];
      }
    },

    async print(scope, job, onStatus = () => {}) {
      try {
        const found = await find(scope, job.printerId);
        if (typeof found === 'string') return { sent: false, message: found };
        const { printer } = found;
        const paper = paperForSize(printer.papers, job.width, job.height);
        if (!paper) {
          return {
            sent: false,
            message: `“${printer.name}” has no paper of ${paperSizeText(job)}. Choose another printer, or download the PDF.`,
          };
        }
        // One copy: the caller's PDF already holds every page it wants on paper.
        return await send(
          scope,
          {
            printerId: printer.id,
            paperName: paper.name,
            copies: 1,
            mediaType: job.settings?.mediaType ?? null,
            quality: job.settings?.quality ?? null,
          },
          job.pdf,
          onStatus,
        );
      } catch (caught) {
        // A job that could not be opened: offline, not permitted, too large.
        return failed(caught, 'Could not print.');
      }
    },

    async receipts(scope) {
      try {
        const [agents, fallback] = await Promise.all([client().agents(scope), client().receiptDefault(scope)]);
        const printers = agents.flatMap((agent) =>
          agent.printers.flatMap((printer) =>
            printer.gone || printer.receipt === null
              ? []
              : [
                  {
                    id: printer.id,
                    name: receiptPrinterName(printer),
                    computer: agent.name,
                    paperWidth: printer.receipt.paperWidth,
                    isDefault: printer.id === fallback,
                    blocked: cannotPrintReason(agent, printer),
                    offlineSince: agent.online ? null : agent.lastSeenAt,
                  },
                ],
          ),
        );
        return { printers, pick: pickReceiptPrinter(printers, device.read(scope.workspaceId)) };
      } catch {
        return {
          printers: [],
          pick: { kind: 'ask', reason: 'The receipt printers could not be read. Print the receipt on a page.' },
        };
      }
    },

    chooseReceiptPrinter(scope, printerId) {
      device.write(scope.workspaceId, printerId);
    },

    async printReceipt(scope, job, onStatus = () => {}) {
      try {
        if (checkReceipt(job.lines)) return { sent: false, message: RECEIPT_REFUSED };
        const found = await find(scope, job.printerId);
        if (typeof found === 'string') return { sent: false, message: found };
        const { receipt } = found.printer;
        if (!receipt) {
          return {
            sent: false,
            message: `“${found.printer.name}” is not a receipt printer. Print the receipt on a page.`,
          };
        }
        // Encoded for THIS printer: its width, its cutter, whether it can draw a QR code.
        const bytes = encodeReceipt(job.lines, receiptProfileOf(receipt));
        return await send(
          scope,
          { printerId: job.printerId, paperName: null, copies: 1, format: 'escpos' },
          bytes,
          onStatus,
        );
      } catch (caught) {
        return failed(caught, 'Could not print the receipt.');
      }
    },

    async printReceiptAsPage(scope, job, onStatus = () => {}) {
      try {
        if (checkReceipt(job.lines)) return { sent: false, message: RECEIPT_REFUSED };
        const found = await find(scope, job.printerId);
        if (typeof found === 'string') return { sent: false, message: found };
        const { printer } = found;
        if (printer.receipt)
          return { sent: false, message: `“${receiptPrinterName(printer)}” prints receipts as text.` };
        // A4 where it has it, else its first paper: the paper in its tray, never a size it would refuse.
        const paper = defaultRulerPaper(printer.papers);
        if (!paper) return { sent: false, message: `“${printer.name}” has reported no paper. Choose another printer.` };
        return await send(
          scope,
          { printerId: printer.id, paperName: paper.name, copies: 1, mediaType: null, quality: null },
          receiptPagePdf(job.lines, paper),
          onStatus,
        );
      } catch (caught) {
        return failed(caught, 'Could not print the receipt.');
      }
    },
  };
}
