import type { StudioRefusal } from '../types.js';
import { cleanText } from './layout.js';
import { STUDIO_PAPER_MAX } from './papers.js';
import { isWholeNumber } from './units.js';

/**
 * The print log (PRINT-STUDIO-PLAN decisions 10 and 22): who made a result,
 * when, on what paper, and the NAMES of the files in it. Never the files.
 *
 * ⚠ A FILE NAME IS OFTEN A CUSTOMER'S NAME (`juan-dela-cruz.jpg`). So the log
 * is personal data even though it holds no photo: names are capped in count
 * and length, stripped of any folder path, and the rows are pruned after
 * `STUDIO_LOG_RETENTION_DAYS`.
 */

/**
 *   downloaded     — the result file was saved to the computer.
 *   sent_to_print  — the browser's print dialog was opened.
 *
 * ⚠ NEITHER MEANS PAPER CAME OUT. A browser never tells a page whether a print
 * finished or was cancelled. A real `printed` needs the print agent
 * (PRINT-STUDIO-PLAN §10).
 */
export type StudioLogAction = 'downloaded' | 'sent_to_print';

export const STUDIO_LOG_ACTIONS = ['downloaded', 'sent_to_print'] as const satisfies readonly StudioLogAction[];

/**
 *   layout — photos in a layout's cells.
 *   pages  — a document printed as whole pages.
 */
export type StudioLogKind = 'layout' | 'pages';

export const STUDIO_LOG_KINDS = ['layout', 'pages'] as const satisfies readonly StudioLogKind[];

/** How long a log row is kept. The default; a host may set its own. */
export const STUDIO_LOG_RETENTION_DAYS = 90;

/** The most file names one entry keeps. A result of 50 pages of ID photos is still a few dozen files. */
export const STUDIO_LOG_FILE_NAMES_MAX = 50;
export const STUDIO_LOG_FILE_NAME_MAX = 120;
export const STUDIO_LOG_PAGES_MAX = 2000;
export const STUDIO_LOG_COPIES_MAX = 999;
const STUDIO_LOG_LABEL_MAX = 80;

export interface StudioLogEntry {
  action: StudioLogAction;
  kind: StudioLogKind;
  /** The saved layout used, if any. A preset or an unsaved layout has none. */
  layoutId: string | null;
  /** A COPY of the layout's name, so the log still reads after the layout is renamed or deleted. */
  layoutName: string | null;
  paperLabel: string;
  /** Hundredths of a millimetre, as oriented. */
  paperWidth: number;
  paperHeight: number;
  pages: number;
  copies: number;
  fileNames: string[];
}

/** An entry as the studio sends it, checked and cleaned. The only way one reaches the database. */
export function prepareLogEntry(value: unknown): { entry: StudioLogEntry } | { refused: StudioRefusal } {
  if (typeof value !== 'object' || value === null) return { refused: 'invalid_log' };
  const input = value as Record<string, unknown>;

  const { action, kind, pages, copies, paperWidth, paperHeight } = input;
  if (!isLogAction(action) || !isLogKind(kind)) return { refused: 'invalid_log' };
  if (!isCount(pages, STUDIO_LOG_PAGES_MAX) || !isCount(copies, STUDIO_LOG_COPIES_MAX))
    return { refused: 'invalid_log' };
  if (!isCount(paperWidth, STUDIO_PAPER_MAX) || !isCount(paperHeight, STUDIO_PAPER_MAX))
    return { refused: 'invalid_log' };
  if (typeof input.paperLabel !== 'string') return { refused: 'invalid_log' };
  if (!Array.isArray(input.fileNames)) return { refused: 'invalid_log' };

  const layoutId = typeof input.layoutId === 'string' && /^[\w-]{1,64}$/u.test(input.layoutId) ? input.layoutId : null;
  const layoutName =
    typeof input.layoutName === 'string' ? cleanText(input.layoutName).slice(0, STUDIO_LOG_LABEL_MAX) : '';

  return {
    entry: {
      action,
      kind,
      layoutId,
      layoutName: layoutName || null,
      paperLabel: cleanText(input.paperLabel).slice(0, STUDIO_LOG_LABEL_MAX),
      paperWidth,
      paperHeight,
      pages,
      copies,
      fileNames: cleanFileNames(input.fileNames),
    },
  };
}

/**
 * File names as the log keeps them: the name only, never a folder; one line;
 * capped in length; each once; at most `STUDIO_LOG_FILE_NAMES_MAX`.
 *
 * ⚠ THE PATH IS DROPPED. A browser gives only the name, but a name is a string
 * a client sends, and `C:\Users\maria\Customers\…` would put a staff member's
 * folder layout in the database.
 */
export function cleanFileNames(values: readonly unknown[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (names.length >= STUDIO_LOG_FILE_NAMES_MAX) break;
    if (typeof value !== 'string') continue;
    const base = value.split(/[\\/]/u).pop() ?? '';
    const name = [...cleanText(base)].slice(0, STUDIO_LOG_FILE_NAME_MAX).join('');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** Rows created before this instant are past their keep and may be pruned. */
export function logCutoff(now: Date, retentionDays: number = STUDIO_LOG_RETENTION_DAYS): Date {
  const days = Math.max(Math.trunc(retentionDays), 1);
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function isLogAction(value: unknown): value is StudioLogAction {
  return (STUDIO_LOG_ACTIONS as readonly unknown[]).includes(value);
}

function isLogKind(value: unknown): value is StudioLogKind {
  return (STUDIO_LOG_KINDS as readonly unknown[]).includes(value);
}

function isCount(value: unknown, max: number): value is number {
  return isWholeNumber(value) && value >= 1 && value <= max;
}
