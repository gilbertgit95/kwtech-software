import type {
  PrintMargins,
  PrintPaper,
  PrintPrinterSettings,
  PrintPrinterStatus,
  PrintRefusal,
  PrintReportedPrinter,
  PrintSettingOption,
} from '../types.js';
import { cleanLine } from './agents.js';

/**
 * What a computer says about its printers, checked before any of it is stored.
 *
 * ⚠ THE SENDER IS A PROGRAM ON SOMEBODY'S COMPUTER, holding a secret that can
 * leak. Everything it reports is treated as a stranger's input: bounded in
 * count and length, whole numbers only, and cleaned to one line, because these
 * names are shown to people in the web app.
 */

/** A shop has a handful; a print server a few dozen. Fifty is refused as a mistake, not cut. */
export const PRINT_PRINTERS_MAX = 50;

/** Epson’s own driver lists 28 for one A4 inkjet, and Microsoft’s XPS writer 107 (the proof, 2026-10-07). */
export const PRINT_PAPERS_MAX = 200;

export const PRINT_PRINTER_NAME_MAX = 200;

export const PRINT_PAPER_NAME_MAX = 100;

/** Two metres, in hundredths of a millimetre. Past it a number is a unit mistake, not a paper. */
export const PRINT_LENGTH_MAX = 200_000;

const STATUSES: readonly PrintPrinterStatus[] = ['ready', 'offline', 'error', 'unknown'];

/** A wire string as a status. Anything unrecognised is `unknown`, never a refusal: a newer agent may know more words. */
export function toPrinterStatus(value: unknown): PrintPrinterStatus {
  return STATUSES.find((status) => status === value) ?? 'unknown';
}

/**
 * A whole report, checked. `invalid_printers` for anything that is not a list
 * of well-formed printers — ONE reason, because the reader is a program and
 * the detail belongs in its own log, not in an answer to an untrusted sender.
 *
 * ⚠ TWO PRINTERS WITH ONE NAME ARE REFUSED. The name is what a job is sent to
 * and what the row is unique on; keeping "the first" would silently send a
 * job to whichever the operating system resolves.
 */
export function prepareReportedPrinters(
  value: unknown,
): { printers: PrintReportedPrinter[] } | { refused: PrintRefusal } {
  if (!Array.isArray(value) || value.length > PRINT_PRINTERS_MAX) return { refused: 'invalid_printers' };
  const printers: PrintReportedPrinter[] = [];
  const names = new Set<string>();
  for (const entry of value) {
    const printer = preparePrinter(entry);
    if (!printer || names.has(printer.name)) return { refused: 'invalid_printers' };
    names.add(printer.name);
    printers.push(printer);
  }
  return { printers };
}

function preparePrinter(value: unknown): PrintReportedPrinter | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, driver, isDefault, status, papers, settings } = value as Record<string, unknown>;
  const cleanName = boundedLine(name, PRINT_PRINTER_NAME_MAX);
  if (cleanName === null) return null;
  const cleanPapers = preparePapers(papers);
  if (!cleanPapers) return null;
  return {
    name: cleanName,
    // A printer with no driver name is still a printer; the column says so.
    driver: boundedLine(driver, PRINT_PRINTER_NAME_MAX) ?? '',
    isDefault: isDefault === true,
    status: toPrinterStatus(status),
    papers: cleanPapers,
    settings: prepareSettings(settings),
  };
}

/** The most choices one setting may offer. A driver lists a dozen paper types; past this it is not a list of them. */
export const PRINT_SETTING_OPTIONS_MAX = 60;

/** The longest a choice's id or label may be. */
export const PRINT_SETTING_TEXT_MAX = 100;

/** A driver's word for a choice: `psk:Plain`, `ns0000:HighQuality`. Nothing that could be mistaken for markup or a path. */
const SETTING_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;

/**
 * A printer's settings, checked — from a report, and again when read back out
 * of the `Json` column.
 *
 * ⚠ NEVER A REFUSAL. Settings are an extra: a computer running an older agent
 * sends none, and one bad entry must not cost a workspace its printer. What
 * cannot be read is left out, and a setting with nothing left is empty, which
 * means "leave it as the printer is set".
 */
export function prepareSettings(value: unknown): PrintPrinterSettings {
  const given = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const mediaTypes = prepareOptions(given.mediaTypes);
  const qualities = prepareOptions(given.qualities);
  return {
    mediaTypes,
    mediaType: chosenOption(given.mediaType, mediaTypes) ?? null,
    qualities,
    quality: chosenOption(given.quality, qualities) ?? null,
  };
}

function prepareOptions(value: unknown): PrintSettingOption[] {
  if (!Array.isArray(value)) return [];
  const options: PrintSettingOption[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, PRINT_SETTING_OPTIONS_MAX)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, label } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || id.length > PRINT_SETTING_TEXT_MAX || !SETTING_ID_PATTERN.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    // A choice the driver gave no name is shown by its id rather than dropped: it can still be chosen.
    options.push({ id, label: boundedLine(label, PRINT_SETTING_TEXT_MAX) ?? id });
  }
  return options;
}

/**
 * A choice, as one of the options offered. Null for "none made"; `undefined`
 * for something that is not one of them, which a caller that must be strict
 * (a job) refuses and one that must not be (a report) reads as none.
 */
export function chosenOption(value: unknown, options: readonly PrintSettingOption[]): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && options.some((option) => option.id === value) ? value : undefined;
}

/**
 * A printer's papers, checked — from a report, and again when read back out of
 * the `Json` column, which is why this is exported. Null for anything that is
 * not a list of well-formed papers.
 */
export function preparePapers(value: unknown): PrintPaper[] | null {
  if (!Array.isArray(value) || value.length > PRINT_PAPERS_MAX) return null;
  const papers: PrintPaper[] = [];
  for (const entry of value) {
    const paper = preparePaper(entry);
    if (!paper) return null;
    papers.push(paper);
  }
  return papers;
}

function preparePaper(value: unknown): PrintPaper | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, width, height, margins } = value as Record<string, unknown>;
  const cleanName = boundedLine(name, PRINT_PAPER_NAME_MAX);
  if (cleanName === null || !isLength(width) || !isLength(height) || width === 0 || height === 0) return null;
  const cleanMargins = margins == null ? null : prepareMargins(margins, width, height);
  // ⚠ Margins that were SENT and are wrong refuse the paper; only absent ones are "unknown".
  if (margins != null && !cleanMargins) return null;
  return { name: cleanName, width, height, margins: cleanMargins };
}

function prepareMargins(value: unknown, width: number, height: number): PrintMargins | null {
  if (typeof value !== 'object' || value === null) return null;
  const { top, right, bottom, left } = value as Record<string, unknown>;
  if (!isLength(top) || !isLength(right) || !isLength(bottom) || !isLength(left)) return null;
  // Margins that leave nothing to print on are a driver's nonsense, not a paper.
  if (left + right >= width || top + bottom >= height) return null;
  return { top, right, bottom, left };
}

function isLength(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= PRINT_LENGTH_MAX;
}

/** One clean, non-empty line of at most `max` characters, or null. */
function boundedLine(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const line = cleanLine(value);
  return line.length > 0 && [...line].length <= max ? line : null;
}

/**
 * What a new report does to the printers already known for a computer: which
 * to write, and which are no longer there.
 *
 * Pure so the service is only I/O: `gone` are names known and not reported.
 */
export function planPrinterReport(
  known: readonly string[],
  reported: readonly PrintReportedPrinter[],
): { write: readonly PrintReportedPrinter[]; gone: readonly string[] } {
  const names = new Set(reported.map((printer) => printer.name));
  return { write: reported, gone: known.filter((name) => !names.has(name)) };
}

/**
 * How far a paper's sides may differ from the size asked for and still be that
 * paper. Hundredths of a millimetre: one millimetre.
 *
 * Drivers and people round differently: a "4R" is 101.6 × 152.4 mm to a driver
 * that thinks in inches and 102 × 152 mm to somebody who typed it. A
 * millimetre covers that, and is far less than the gap between any two papers
 * a shop loads.
 */
export const PRINT_PAPER_MATCH_TOLERANCE = 100;

/**
 * The paper, among those a printer reported, that a page of this size is
 * printed on. Null when it has none.
 *
 * ⚠ NULL IS A REFUSAL, NOT "USE THE DEFAULT". A page sent without its paper
 * prints on whatever the printer is set to, at the wrong size and silently
 * (`prepareJobOptions`). Somebody sending a 4R sheet to a printer that only
 * lists A4 has to be told.
 *
 * Either way round: a driver lists a paper as it is fed, nearly always
 * portrait, and a landscape page is still that paper. The closest wins, so a
 * custom size a millimetre off does not beat the standard one.
 */
export function paperForSize(papers: readonly PrintPaper[], width: number, height: number): PrintPaper | null {
  let best: { paper: PrintPaper; off: number } | null = null;
  for (const paper of papers) {
    const off = Math.min(
      sidesOff(paper.width, paper.height, width, height),
      sidesOff(paper.height, paper.width, width, height),
    );
    if (off <= PRINT_PAPER_MATCH_TOLERANCE && (best === null || off < best.off)) best = { paper, off };
  }
  return best?.paper ?? null;
}

/** The larger of the two sides' differences. */
function sidesOff(paperWidth: number, paperHeight: number, width: number, height: number): number {
  return Math.max(Math.abs(paperWidth - width), Math.abs(paperHeight - height));
}
