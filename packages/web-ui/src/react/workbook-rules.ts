/**
 * The rules behind the workbook helpers and the import wizard (issue #35),
 * pure, so they are tested without a file or a browser.
 *
 * ⚠ THE SHAPES ARE COPIED, NOT IMPORTED. `@kwtech/web-ui` imports no other
 * `@kwtech` package (docs/DEPENDENCIES.md), so a sheet here is the subset of
 * `module-kit`'s `SheetSpec` it needs, declared structurally: a module passes
 * its `SheetSpec` as it is and TypeScript checks that it fits. Keep them in step
 * with `packages/module-kit/src/spreadsheet.ts`.
 */

/** A column as the workbook writes it: `module-kit`'s `SheetColumn`, structurally. */
export interface WorkbookColumn {
  key: string;
  header: string;
  kind: 'text' | 'integer' | 'money' | 'yes_no' | 'choice';
  required?: boolean;
  choices?: readonly string[];
  /** Keep the cell as text, so Excel cannot turn 007 into 7. */
  textFormat?: boolean;
  /** Offer another tab's column as a dropdown. */
  listFrom?: { sheet: string; header: string };
  example: string | number | boolean | null;
}

/** A tab as the workbook writes it: `module-kit`'s `SheetSpec`, structurally. */
export interface WorkbookSheet {
  name: string;
  columns: readonly WorkbookColumn[];
}

/** A value in the units the module holds it: money in CENTAVOS, yes/no as a boolean. */
export type WorkbookValue = string | number | boolean | null;

/** A row of the file as read: its row number in Excel and its raw cells, left to right. */
export interface WorkbookRow {
  line: number;
  cells: unknown[];
}

export interface WorkbookTab {
  name: string;
  rows: WorkbookRow[];
}

/** A whole file, read: every tab, in order. `module-kit`'s `readSheet` takes a tab's rows as they are. */
export interface WorkbookReading {
  fileName: string;
  tabs: WorkbookTab[];
}

/** The largest file the browser will open: a store's setup is kilobytes, so megabytes are a wrong file. */
export const WORKBOOK_MAX_BYTES = 5 * 1024 * 1024;

/** The most rows one tab may have: past it the tab is refused rather than freezing the page reading it. */
export const WORKBOOK_MAX_ROWS = 10_000;

/** How many rows the template prepares — text format and dropdowns — below the heading. */
export const WORKBOOK_PREPARED_ROWS = 1000;

/** Whether this is a file the reader can open, or what to say. Only `.xlsx`: the old `.xls` is a different format. */
export function checkWorkbookFile(file: { name: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) return 'This is an old Excel file (.xls). Open it in Excel and save it as .xlsx.';
  if (!name.endsWith('.xlsx')) return 'Choose an Excel file (.xlsx).';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > WORKBOOK_MAX_BYTES) return 'This file is too large to be a setup file (more than 5 MB).';
  return null;
}

/**
 * A module's value → what the cell holds: money from centavos to pesos (1250 →
 * 12.5, shown as 12.50 by the cell's format), yes/no as the words the import
 * reads back. Everything else as it is.
 */
export function workbookCell(column: Pick<WorkbookColumn, 'kind'>, value: WorkbookValue): string | number | null {
  if (value === null) return null;
  switch (column.kind) {
    case 'money':
      return typeof value === 'number' ? value / 100 : null;
    case 'yes_no':
      if (typeof value !== 'boolean') return null;
      return value ? 'Yes' : 'No';
    case 'integer':
      return typeof value === 'number' ? value : null;
    case 'text':
    case 'choice':
      return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value;
  }
}

/**
 * The dropdown a column offers in Excel, as a data-validation formula, or null.
 *
 * ⚠ Excel limits a typed-in list to 255 characters. A longer one is left with
 * no dropdown rather than written into a file Excel then "repairs" by
 * dropping every dropdown; the import still checks the value.
 */
export function workbookDropdown(
  column: Pick<WorkbookColumn, 'kind' | 'choices' | 'listFrom'>,
  sheets: readonly WorkbookSheet[],
  lastRow: number = WORKBOOK_PREPARED_ROWS + 1,
): string | null {
  if (column.kind === 'yes_no') return '"Yes,No"';
  if (column.kind === 'choice') {
    const list = (column.choices ?? []).join(',');
    if (!list || list.length > 255 || list.includes('"')) return null;
    return `"${list}"`;
  }
  if (!column.listFrom) return null;
  const { sheet, header } = column.listFrom;
  const source = sheets.find((candidate) => candidate.name === sheet);
  const position = source?.columns.findIndex((candidate) => candidate.header === header) ?? -1;
  if (!source || position < 0) return null;
  const letter = columnLetter(position);
  // Quoted always: a tab name with a space ("Order types") must be.
  return `'${sheet.replace(/'/gu, "''")}'!$${letter}$2:$${letter}$${lastRow}`;
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let letters = '';
  let rest = index + 1;
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

/**
 * `pos-setup-kwtech-printing-ib-2026-11-03.xlsx`: what, whose, and the day —
 * the WORKSPACE's day, passed in, never the browser's.
 */
export function workbookFileName(what: string, whose: string, dayKey: string): string {
  const slug = (text: string) =>
    text
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '');
  return `${[slug(what), slug(whose), dayKey].filter(Boolean).join('-')}.xlsx`;
}

// ── the wizard ──────────────────────────────────────────────────────────────

/** Add and update (the default), or Replace: also archive what the file leaves out. */
export type ImportWizardMode = 'merge' | 'replace';

/** What one tab's import will do: `module-kit`'s `SheetPlanCounts`, structurally. */
export interface ImportWizardCounts {
  create: number;
  update: number;
  unchanged: number;
  archive: number;
  errors: number;
}

/** One problem, where the person will find it. */
export interface ImportWizardProblem {
  line: number | null;
  column: string | null;
  message: string;
}

export interface ImportWizardSheet {
  name: string;
  /** The tab is not in the file: left alone, and said so. */
  missing: boolean;
  counts: ImportWizardCounts;
  problems: ImportWizardProblem[];
  /** What Replace will archive, by name, so the person sees it before confirming. */
  archived: string[];
}

/** What the module says the file would do: per tab, and anything wrong with the file as a whole. */
export interface ImportWizardPreview {
  sheets: ImportWizardSheet[];
  /** Wrong with the whole file or a whole tab: nothing is imported until it is fixed. */
  fatal: string[];
}

/** What the import did, per tab. */
export interface ImportWizardOutcome {
  sheets: { name: string; created: number; updated: number; archived: number }[];
}

/** "12 new, 3 updated, 1 unchanged, 2 with errors" — the parts that are not zero; "Nothing" when all are. */
export function importSummary(counts: ImportWizardCounts): string {
  const parts: string[] = [];
  if (counts.create) parts.push(`${counts.create} new`);
  if (counts.update) parts.push(`${counts.update} updated`);
  if (counts.archive) parts.push(`${counts.archive} to archive`);
  if (counts.unchanged) parts.push(`${counts.unchanged} unchanged`);
  if (counts.errors) parts.push(`${counts.errors} with errors`);
  return parts.length === 0 ? 'Nothing in this sheet' : parts.join(', ');
}

/** Every tab's counts added up. */
export function importTotals(preview: Pick<ImportWizardPreview, 'sheets'>): ImportWizardCounts {
  const total: ImportWizardCounts = { create: 0, update: 0, unchanged: 0, archive: 0, errors: 0 };
  for (const sheet of preview.sheets) {
    total.create += sheet.counts.create;
    total.update += sheet.counts.update;
    total.unchanged += sheet.counts.unchanged;
    total.archive += sheet.counts.archive;
    total.errors += sheet.counts.errors;
  }
  return total;
}

/**
 * Whether Import may be pressed, or why not.
 *
 * ⚠ ALL OR NOTHING unless the person chose otherwise: rows with errors stop the
 * import, and only an explicit "skip the rows with errors" lets the rest go.
 * A fatal problem (a heading missing) is never skipped: the tab was not read.
 */
export function importBlocker(preview: ImportWizardPreview, skipErrorRows: boolean): string | null {
  if (preview.fatal.length > 0) return 'Fix the problems with the file first.';
  const total = importTotals(preview);
  if (total.errors > 0 && !skipErrorRows) return 'Fix the rows with errors, or choose to skip them.';
  if (total.create + total.update + total.archive === 0)
    return 'Nothing to change: the store already matches this file.';
  return null;
}

/** The Import button: "Import 15 changes". */
export function importButtonLabel(preview: Pick<ImportWizardPreview, 'sheets'>): string {
  const total = importTotals(preview);
  const changes = total.create + total.update + total.archive;
  return changes === 1 ? 'Import 1 change' : `Import ${changes} changes`;
}

/** Where a problem is, as the person will look for it: "Row 7 · Price". */
export function problemPlace(problem: Pick<ImportWizardProblem, 'line' | 'column'>): string {
  const parts = [problem.line === null ? null : `Row ${problem.line}`, problem.column];
  return parts.filter(Boolean).join(' · ') || 'The whole sheet';
}
