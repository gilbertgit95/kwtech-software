import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { paperKey, type RawWindowsPrinter, toReport } from './convert.js';
import type { PrinterDriver } from './driver.js';
import { WINDOWS_PRINTERS_SCRIPT, WINDOWS_TICKET_SCRIPT } from './windows-script.js';

/**
 * Asking takes a while: each paper of each printer is a call into its driver
 * (39 s for ten queues on the proof computer, most of it Microsoft's virtual
 * printers, which are excluded by default). Two minutes is a driver that hung.
 */
const LIST_TIMEOUT_MS = 120_000;

/** A printer with a hundred papers is a few kilobytes of JSON; this is a runaway script. */
const LIST_MAX_BYTES = 16 * 1024 * 1024;

/** Runs the script and returns what it printed. The seam the tests replace. */
export type RunPowerShell = (script: string, variables: Record<string, string>) => Promise<string>;

/**
 * `powershell.exe` — Windows PowerShell 5.1, which every supported Windows
 * ships. Not `pwsh`: that is a separate install a shop's computer may not
 * have, and `System.Drawing.Printing` is not in it by default.
 */
export const runWindowsPowerShell: RunPowerShell = (script, variables) =>
  new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        env: { ...process.env, ...variables },
        timeout: LIST_TIMEOUT_MS,
        maxBuffer: LIST_MAX_BYTES,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Windows could not be asked for its printers — ${stderr.trim() || error.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });

/** What `pdf-to-printer` is asked. The seam the tests replace. */
export interface PdfPrintOptions {
  printer: string;
  scale: 'noscale';
  silent: true;
  copies: number;
  paperKind?: number;
  sumatraPdfPath?: string;
}
export type PrintPdf = (file: string, options: PdfPrintOptions) => Promise<void>;

/**
 * `pdf-to-printer`, loaded when the first job arrives: it carries SumatraPDF,
 * which a computer that only lists printers never needs to find.
 *
 * It is CommonJS; depending on how it is loaded its `print` is on the module
 * or on its default.
 */
export const printWithSumatra: PrintPdf = async (file, options) => {
  const loaded = (await import('pdf-to-printer')) as unknown as {
    print?: PrintPdf;
    default?: { print?: PrintPdf };
  };
  const print = loaded.print ?? loaded.default?.print;
  if (!print) throw new Error('The printing library could not be loaded.');
  await print(file, options);
};

/**
 * The printers Windows has installed, wireless and USB alike, read through
 * their own drivers — and printing on them, through those same drivers.
 *
 * ⚠ `scale: 'noscale'` ON EVERY JOB. The page is already the paper's size;
 * "fit" or "shrink" would resize it to the printable area, and an exact
 * layout would come out a few percent small (proved on the L5290, 2026-10-07).
 *
 * ⚠ A PAPER IS NAMED BY THE DRIVER'S OWN NUMBER, from the last listing. A
 * driver's papers have no name SumatraPDF knows beyond a dozen standard ones.
 * A paper not in the listing is refused, never guessed: printing on "whatever
 * is loaded" puts an exact layout on the wrong sheet.
 *
 * `onSkipped` is told the names left out of the report (see `toReport`), so
 * the agent's log says why a printer is missing from the web app.
 */
export function createWindowsDriver(
  excluded: readonly string[],
  options: {
    run?: RunPowerShell;
    print?: PrintPdf;
    /** Another SumatraPDF than the one the library carries. */
    sumatraPath?: string;
    onSkipped?: (names: readonly string[]) => void;
    /** Hears when a driver printed with another setting than the job asked for. */
    onNote?: (message: string) => void;
  } = {},
): PrinterDriver {
  const run = options.run ?? runWindowsPowerShell;
  const printPdf = options.print ?? printWithSumatra;
  /** Each paper's number in its driver, from the last listing. */
  let kinds: Map<string, number> | null = null;
  return {
    async print(request) {
      let paperKind: number | undefined;
      if (request.paper) {
        const key = paperKey(request.printerName, request.paper.name);
        // A job can arrive before the first listing has finished, or name a paper added since.
        if (!kinds?.has(key)) await this.list();
        paperKind = kinds?.get(key);
        if (paperKind === undefined) {
          throw new Error(
            `Windows does not list the paper "${request.paper.name}" for "${request.printerName}" any more.`,
          );
        }
      }
      /*
       * ⚠ A PAPER TYPE OR QUALITY IS SET ON THE QUEUE, the job printed, and
       * the queue put back — in `finally`, so a job that fails does not leave
       * a shop's printer on glossy. Why it has to be done this way, and what
       * it costs, is on `WINDOWS_TICKET_SCRIPT`.
       *
       * ⚠ A SETTING THAT CANNOT BE SET STOPS THE JOB. Glossy paper printed as
       * plain is a ruined sheet; a refusal costs nothing.
       */
      const wanted = { mediaType: request.mediaType ?? null, quality: request.quality ?? null };
      const ticketFile =
        wanted.mediaType || wanted.quality ? join(dirname(request.file), 'printer-settings.xml') : null;
      const ticket = (mode: 'apply' | 'restore') =>
        run(WINDOWS_TICKET_SCRIPT, {
          KW_PRINT_MODE: mode,
          KW_PRINT_PRINTER: request.printerName,
          KW_PRINT_TICKET_FILE: ticketFile ?? '',
          KW_PRINT_MEDIA: wanted.mediaType ?? '',
          KW_PRINT_QUALITY: wanted.quality ?? '',
        });
      const restore = async () => {
        await ticket('restore').catch(() => {
          options.onNote?.(
            `"${request.printerName}" could not be put back to its own settings. Check its printing preferences in Windows.`,
          );
        });
      };
      if (ticketFile) {
        let answer: string;
        try {
          answer = await ticket('apply');
        } catch (error) {
          const detail = error instanceof Error ? error.message.replace(/^.*? — /u, '') : String(error);
          throw new Error(`The printer's settings could not be set — ${detail}`);
        }
        const got = readTicketAnswer(answer);
        for (const key of ['mediaType', 'quality'] as const) {
          if (wanted[key] && got[key] && got[key] !== wanted[key]) {
            options.onNote?.(
              `"${request.printerName}" is printing with ${got[key]}, not ${wanted[key]}: its driver does not do that combination.`,
            );
          }
        }
      }
      try {
        await printPdf(request.file, {
          printer: request.printerName,
          scale: 'noscale',
          silent: true,
          copies: request.copies,
          ...(paperKind === undefined ? {} : { paperKind }),
          ...(options.sumatraPath ? { sumatraPdfPath: options.sumatraPath } : {}),
        });
      } finally {
        if (ticketFile) await restore();
      }
    },
    async list() {
      const output = await run(WINDOWS_PRINTERS_SCRIPT, { KW_PRINT_EXCLUDE: JSON.stringify(excluded) });
      let raw: unknown;
      try {
        // PowerShell prints a byte-order mark first on some consoles, which `JSON.parse` refuses.
        raw = JSON.parse(output.replace(/^﻿/, '').trim());
      } catch {
        throw new Error('Windows answered with something that is not a list of printers.');
      }
      // ⚠ `ConvertTo-Json -InputObject` of an empty array prints nothing useful on 5.1; treat anything not a list as none.
      const report = toReport(Array.isArray(raw) ? (raw as RawWindowsPrinter[]) : [], excluded);
      if (report.skipped.length > 0) options.onSkipped?.(report.skipped);
      kinds = report.kinds;
      return report.printers;
    },
  };
}

/** What the driver settled on, from the ticket script's one line of JSON. Empty when it said nothing readable. */
function readTicketAnswer(output: string): { mediaType?: string; quality?: string } {
  try {
    const parsed = JSON.parse(output.replace(/^\uFEFF/u, '').trim()) as Record<string, unknown>;
    return {
      ...(typeof parsed.mediaType === 'string' ? { mediaType: parsed.mediaType } : {}),
      ...(typeof parsed.quality === 'string' ? { quality: parsed.quality } : {}),
    };
  } catch {
    return {};
  }
}
