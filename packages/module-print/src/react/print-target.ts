'use client';

import { paperForSize } from '../domain/printers.js';
import { createPrintClient, type PrintClient, type PrintPrinterView, type PrintScopeView } from './print-client.js';
import { printThroughAgent } from './print-flow.js';
import { cannotPrintReason, jobStatusText, paperSizeText } from './view.js';

/**
 * This module as somewhere ANOTHER module can print to: the printers a person
 * may choose, and "put this PDF on that one".
 *
 * ## Why it exists
 *
 * The print studio makes a PDF and wants it on paper. A module may not import
 * a module (PLAN §9), so the studio declares what it needs as a port and the
 * web app binds this to it, in a client file:
 *
 *   <StudioPrinterProvider printer={PRINT_TARGET}>   // const PRINT_TARGET = createPrintTarget()
 *
 * The shapes below are this module's own. They fit the studio's port because
 * the two were written to, and the app's compiler checks that they still do.
 *
 * ⚠ THE CALLER NEVER NAMES A PAPER. It says how large its page is, and the
 * paper is found among those the printer reported (`paperForSize`). A page
 * with no paper of its size is refused here, with a sentence, before a job is
 * opened.
 *
 * ⚠ NOTHING IS KEPT. The file is passed to the job and let go; this writes to
 * no browser storage and holds no list between calls.
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

export interface PrintTarget {
  /**
   * The workspace's printers, gone ones left out.
   *
   * ⚠ EMPTY FOR SOMEBODY WHO MAY NOT SEE THEM, and when they cannot be read.
   * The caller offers what it offered before this existed; the Printers page
   * is where a refusal is explained.
   */
  printers(scope: PrintScopeView): Promise<PrintTargetPrinter[]>;
  /** Print one PDF. Never throws: a refusal is an outcome with its sentence. `onStatus` hears each step. */
  print(scope: PrintScopeView, job: PrintTargetJob, onStatus?: (text: string) => void): Promise<PrintTargetOutcome>;
}

export interface PrintTargetOptions {
  /** The API client. Made on first use when left out, so this can be called where there is no browser yet. */
  client?: PrintClient;
  /** The seam the tests replace: how the wait between two reads of a job is spent. */
  wait?: (ms: number) => Promise<void>;
}

export function createPrintTarget(options: PrintTargetOptions = {}): PrintTarget {
  let made: PrintClient | null = options.client ?? null;
  const client = () => {
    made ??= createPrintClient();
    return made;
  };

  return {
    async printers(scope) {
      try {
        const agents = await client().agents(scope);
        return agents.flatMap((agent) =>
          agent.printers
            .filter((printer) => !printer.gone)
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
        // Read again, not remembered: the papers are the printer's as it stands now.
        const agents = await client().agents(scope);
        const agent = agents.find((one) => one.printers.some((printer) => printer.id === job.printerId));
        const printer = agent?.printers.find((one) => one.id === job.printerId);
        if (!agent || !printer) return { sent: false, message: 'That printer is no longer paired here.' };
        const blocked = cannotPrintReason(agent, printer);
        if (blocked) return { sent: false, message: blocked };

        const paper = paperForSize(printer.papers, job.width, job.height);
        if (!paper) {
          return {
            sent: false,
            message: `“${printer.name}” has no paper of ${paperSizeText(job)}. Choose another printer, or download the PDF.`,
          };
        }

        // One copy: the caller's PDF already holds every page it wants on paper.
        const ended = await printThroughAgent(
          client(),
          scope,
          {
            printerId: printer.id,
            paperName: paper.name,
            copies: 1,
            mediaType: job.settings?.mediaType ?? null,
            quality: job.settings?.quality ?? null,
          },
          job.pdf,
          (state) => onStatus(jobStatusText(state).label),
          options.wait,
        );
        const said = jobStatusText(ended);
        if (!said.ended) {
          return { sent: false, message: 'The computer has not said how the printing went. Look at the printer.' };
        }
        return { sent: ended?.status === 'printed', message: said.label };
      } catch (caught) {
        // A job that could not be opened: offline, not permitted, too large. The API's sentence is for a reader.
        return { sent: false, message: caught instanceof Error ? caught.message : 'Could not print.' };
      }
    },
  };
}
