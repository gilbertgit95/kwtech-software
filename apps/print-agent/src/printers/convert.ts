import {
  PRINT_PAPERS_MAX,
  PRINT_PRINTERS_MAX,
  type PrintMargins,
  type PrintPaper,
  type PrintPrinterSettings,
  type PrintPrinterStatus,
  type PrintReportedPrinter,
  prepareReportedPrinters,
  prepareSettings,
} from '@kwtech/module-print';

/**
 * Windows' own words about a printer, as the report the server takes.
 *
 * Pure, and where the tests point: everything that can go wrong between a
 * driver's numbers and a paper size is arithmetic here, not a PowerShell
 * script that only runs on one computer.
 */

/** One paper as `windows-script.ts` prints it. Every field may be missing: a driver answers what it likes. */
export interface RawWindowsPaper {
  name?: unknown;
  /**
   * The driver's own number for this paper (`PaperSize.RawKind`). ⚠ It is how
   * a job NAMES a paper when printing: a driver's papers ("4R", "A4
   * borderless") have no name another program knows, only this number.
   */
  kind?: unknown;
  /** From `DeviceCapabilities`: exact, in tenths of a millimetre. Null where the driver gave none. */
  widthTenthsMm?: unknown;
  heightTenthsMm?: unknown;
  /** From .NET: rounded to hundredths of an inch, so A4 reads 827 × 1169 and is 0.06 mm out. The fallback. */
  widthHundredthsIn?: unknown;
  heightHundredthsIn?: unknown;
  /** The printable rectangle, in hundredths of an inch from the paper's top left. */
  area?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null;
}

export interface RawWindowsPrinter {
  name?: unknown;
  driver?: unknown;
  isDefault?: unknown;
  /** `Get-Printer`'s `PrinterStatus`, as text: `Normal`, `Offline`, `PaperJam`, … */
  status?: unknown;
  papers?: unknown;
  /** The driver's paper types and qualities, with its current choice of each. Missing where it could not be asked. */
  settings?: unknown;
}

/**
 * Windows' number for the "user-defined" paper (`DMPAPER_USER`).
 *
 * ⚠ IT IS A SLOT, NOT A PAPER. Its size is whatever was last typed into the
 * driver's custom-size box, and a job that names it gets whatever that is at
 * the moment of printing. An Epson driver reported it as 210 × 297 mm while
 * the queue was set to a 8.5 × 13 inch custom paper; a page matched to it by
 * size came out enlarged (2026-10-07). A driver's NAMED custom papers have
 * numbers of their own and are kept.
 */
export const WINDOWS_USER_PAPER_KIND = 256;

/** Hundredths of a millimetre in one hundredth of an inch. */
const HUNDREDTHS_MM_PER_HUNDREDTH_IN = 25.4;

/**
 * The spooler's status as one of four words.
 *
 * ⚠ LOW INK IS `ready`: the printer still prints, and "needs attention" on
 * every printer whose ink is under half would teach people to ignore it.
 * Anything not recognised is `unknown`, never a guess.
 */
export function toStatus(value: unknown): PrintPrinterStatus {
  if (typeof value !== 'string') return 'unknown';
  switch (value) {
    case 'Normal':
    case 'TonerLow':
    case 'Printing':
    case 'Processing':
    case 'Busy':
    case 'WarmingUp':
    case 'Initializing':
    case 'Waiting':
    case 'PowerSave':
    case 'IOActive':
    case 'ManualFeed':
      return 'ready';
    case 'Offline':
    case 'NotAvailable':
    case 'ServerUnknown':
    case 'ServerOffline':
      return 'offline';
    case 'Error':
    case 'PaperJam':
    case 'PaperOut':
    case 'PaperProblem':
    case 'OutputBinFull':
    case 'NoToner':
    case 'DoorOpen':
    case 'UserIntervention':
    case 'OutOfMemory':
    case 'PagePunt':
    case 'Paused':
      return 'error';
    default:
      return 'unknown';
  }
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function atLeastZero(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * One length in hundredths of a millimetre: the driver's exact tenths where it
 * gave them, else .NET's hundredths of an inch.
 */
function paperLength(tenthsMm: unknown, hundredthsIn: unknown): number | null {
  const exact = positive(tenthsMm);
  if (exact !== null) return Math.round(exact * 10);
  const rounded = positive(hundredthsIn);
  return rounded === null ? null : Math.round(rounded * HUNDREDTHS_MM_PER_HUNDREDTH_IN);
}

/**
 * The unprintable strip at each edge, from the printable rectangle.
 *
 * ⚠ NULL WHEN THE DRIVER'S RECTANGLE IS NOT ONE — missing, empty, or larger
 * than the paper. Null reads as "not reported" in the web app; a made-up zero
 * would read as "prints to the edge", and a page laid out on that is clipped.
 * A rectangle a hair over the paper (rounding) is clamped, not refused.
 */
export function marginsFromArea(area: RawWindowsPaper['area'], width: number, height: number): PrintMargins | null {
  if (!area) return null;
  const x = atLeastZero(area.x);
  const y = atLeastZero(area.y);
  const areaWidth = positive(area.width);
  const areaHeight = positive(area.height);
  if (x === null || y === null || areaWidth === null || areaHeight === null) return null;

  const left = Math.round(x * HUNDREDTHS_MM_PER_HUNDREDTH_IN);
  const top = Math.round(y * HUNDREDTHS_MM_PER_HUNDREDTH_IN);
  const right = Math.max(width - Math.round((x + areaWidth) * HUNDREDTHS_MM_PER_HUNDREDTH_IN), 0);
  const bottom = Math.max(height - Math.round((y + areaHeight) * HUNDREDTHS_MM_PER_HUNDREDTH_IN), 0);
  if (left + right >= width || top + bottom >= height) return null;
  return { top, right, bottom, left };
}

/** One paper, or null for an entry that is not one — no name, no size, or the user-defined slot. */
export function toPaper(raw: RawWindowsPaper): PrintPaper | null {
  if (typeof raw.name !== 'string' || raw.name.trim() === '') return null;
  if (raw.kind === WINDOWS_USER_PAPER_KIND) return null;
  const width = paperLength(raw.widthTenthsMm, raw.widthHundredthsIn);
  const height = paperLength(raw.heightTenthsMm, raw.heightHundredthsIn);
  if (width === null || height === null) return null;
  return { name: raw.name.trim(), width, height, margins: marginsFromArea(raw.area, width, height) };
}

/** What the driver offers besides papers, through the server's own check. Anything it would not keep is left out here too. */
export function toSettings(raw: unknown): PrintPrinterSettings {
  return prepareSettings(raw);
}

/** One paper of one printer, as a key. A newline cannot be in either name: both were cleaned to one line. */
export function paperKey(printerName: string, paperName: string): string {
  return `${printerName}\n${paperName}`;
}

/**
 * Everything Windows listed, as a report the server will accept.
 *
 * ⚠ EACH PRINTER IS PUT THROUGH THE SERVER'S OWN CHECK (`prepareReportedPrinters`,
 * imported, not restated) and LEFT OUT if it fails, because the server refuses
 * a whole report over one bad entry. One driver's nonsense must not hide the
 * shop's other printers. The names left out are returned so the agent can say so.
 *
 * `kinds` is each reported paper's number in its driver, which stays on this
 * computer: the server has no use for it, and a job names a paper by name.
 */
export function toReport(
  raw: readonly RawWindowsPrinter[],
  excluded: readonly string[] = [],
): { printers: PrintReportedPrinter[]; skipped: string[]; kinds: Map<string, number> } {
  const printers: PrintReportedPrinter[] = [];
  const skipped: string[] = [];
  const kinds = new Map<string, number>();
  for (const entry of raw) {
    if (typeof entry.name !== 'string' || excluded.includes(entry.name)) continue;
    if (printers.length >= PRINT_PRINTERS_MAX) {
      skipped.push(entry.name);
      continue;
    }

    const papers: PrintPaper[] = [];
    const names = new Set<string>();
    const ownKinds = new Map<string, number>();
    for (const rawPaper of Array.isArray(entry.papers) ? (entry.papers as RawWindowsPaper[]) : []) {
      const paper = toPaper(rawPaper ?? {});
      // A driver listing one name twice means one paper; the first is the one Windows shows.
      if (!paper || names.has(paper.name) || papers.length >= PRINT_PAPERS_MAX) continue;
      names.add(paper.name);
      papers.push(paper);
      if (typeof rawPaper?.kind === 'number' && Number.isInteger(rawPaper.kind))
        ownKinds.set(paper.name, rawPaper.kind);
    }

    const candidate = {
      name: entry.name,
      driver: typeof entry.driver === 'string' ? entry.driver : '',
      isDefault: entry.isDefault === true,
      status: toStatus(entry.status),
      papers,
      settings: toSettings(entry.settings),
    };
    const checked = prepareReportedPrinters([candidate]);
    const [printer] = 'refused' in checked ? [] : checked.printers;
    if (!printer) {
      skipped.push(entry.name);
      continue;
    }
    printers.push(printer);
    // Keyed by the names the SERVER was given, which is what a job comes back naming.
    for (const paper of printer.papers) {
      const kind = ownKinds.get(paper.name);
      if (kind !== undefined) kinds.set(paperKey(printer.name, paper.name), kind);
    }
  }
  return { printers, skipped, kinds };
}
