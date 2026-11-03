import {
  checkWorkbookFile,
  WORKBOOK_MAX_ROWS,
  WORKBOOK_PREPARED_ROWS,
  type WorkbookReading,
  type WorkbookRow,
  type WorkbookSheet,
  type WorkbookValue,
  workbookCell,
  workbookDropdown,
} from './workbook-rules.js';

/**
 * Reading and writing `.xlsx` IN THE BROWSER (issue #35), with `exceljs`.
 *
 * ⚠ `exceljs` IS AN OPTIONAL PEER, LOADED ONLY HERE, ON DEMAND. It is about
 * 265 KB compressed: importing it at the top would put it in every page that
 * imports `@kwtech/web-ui/react`. A screen pays for it when a person opens an
 * import or an export, and an app that never does need not install it.
 *
 * ⚠ The server never receives the file. A module reads it here into rows, turns
 * them into typed values with `module-kit`'s `readSheet`, and sends those; its
 * mutation checks every value again.
 *
 * Chosen after a trial (PLAN §13, 2026-11-03): Excel 16 opened a file written
 * this way with no repair, kept its dropdowns and kept `007` as text, and
 * Chrome read Excel's own file back correctly.
 */

type ExcelJsModule = typeof import('exceljs');

async function loadExcelJs(): Promise<ExcelJsModule> {
  try {
    const loaded = await import('exceljs');
    // CommonJS through a bundler: the namespace is the module, or wraps it as `default`.
    return (loaded as ExcelJsModule & { default?: ExcelJsModule }).default ?? loaded;
  } catch {
    throw new Error('Excel files cannot be opened here: the app is missing the exceljs package.');
  }
}

/** A tab to write: its columns, and either the module's rows (money in centavos) or the columns' examples. */
export interface WorkbookSheetInput {
  sheet: WorkbookSheet;
  /** The rows, in the module's units. Omitted: one row of each column's `example` — the template. */
  rows?: readonly Readonly<Record<string, WorkbookValue>>[];
}

export interface WriteWorkbookInput {
  /** The Read me tab's rows, first in the file. Omitted: no Read me tab. */
  readMe?: readonly (readonly string[])[];
  sheets: readonly WorkbookSheetInput[];
}

/**
 * A workbook → a file. Each tab gets a bold, frozen heading row; money shown
 * with 2 decimals; text-format columns kept as text, and dropdowns for yes/no,
 * choices and columns listed from another tab — on the rows written and the
 * `WORKBOOK_PREPARED_ROWS` below, so a person filling in the template has them.
 */
export async function writeWorkbook(input: WriteWorkbookInput): Promise<Blob> {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  const specs = input.sheets.map((entry) => entry.sheet);

  if (input.readMe) {
    const readMe = workbook.addWorksheet('Read me');
    readMe.addRows(input.readMe.map((row) => [...row]));
    readMe.getColumn(1).width = 28;
    readMe.getColumn(2).width = 14;
    readMe.getColumn(3).width = 34;
    readMe.getColumn(4).width = 70;
    readMe.getRow(1).font = { bold: true, size: 14 };
  }

  for (const { sheet, rows } of input.sheets) {
    const tab = workbook.addWorksheet(sheet.name);
    tab.addRow(sheet.columns.map((column) => column.header));
    tab.getRow(1).font = { bold: true };
    tab.views = [{ state: 'frozen', ySplit: 1 }];

    if (rows) {
      for (const row of rows) tab.addRow(sheet.columns.map((column) => workbookCell(column, row[column.key] ?? null)));
    } else {
      // The template: what a filled-in cell looks like, as the person would type it.
      tab.addRow(sheet.columns.map((column) => column.example));
    }

    const lastRow = Math.max(tab.rowCount, WORKBOOK_PREPARED_ROWS + 1);
    for (const [index, column] of sheet.columns.entries()) {
      const sheetColumn = tab.getColumn(index + 1);
      sheetColumn.width = Math.min(40, Math.max(10, column.header.length + 4, String(column.example ?? '').length + 2));
      const dropdown = workbookDropdown(column, specs, lastRow);
      for (let line = 2; line <= lastRow; line += 1) {
        const cell = tab.getCell(line, index + 1);
        // ⚠ Text format BEFORE anything is typed: Excel turns a typed 007 into 7, for good.
        if (column.textFormat) cell.numFmt = '@';
        if (column.kind === 'money') cell.numFmt = '#,##0.00';
        if (dropdown) {
          cell.dataValidation = {
            type: 'list',
            allowBlank: !column.required,
            formulae: [dropdown],
            showErrorMessage: true,
            errorTitle: column.header,
            error: 'Choose a value from the list.',
          };
        }
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * A file → its tabs, each as rows of RAW cells with the row numbers Excel
 * shows. Blank rows are left out; `module-kit`'s `prepareSheetCell` turns each
 * cell (a formula, styled text, a link) into a plain value.
 *
 * Throws a sentence for a person: not `.xlsx`, too large, unreadable, or a tab
 * past `WORKBOOK_MAX_ROWS` rows.
 */
export async function readWorkbook(file: Blob & { name: string }): Promise<WorkbookReading> {
  const problem = checkWorkbookFile(file);
  if (problem) throw new Error(problem);
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error('This file could not be read as an Excel workbook. Open it in Excel and save it as .xlsx again.');
  }

  const tabs = workbook.worksheets.map((tab) => {
    if (tab.actualRowCount > WORKBOOK_MAX_ROWS) {
      throw new Error(`The ${tab.name} sheet has more than ${WORKBOOK_MAX_ROWS.toLocaleString()} rows.`);
    }
    const rows: WorkbookRow[] = [];
    tab.eachRow({ includeEmpty: false }, (row, line) => {
      // `values` is 1-based: index 0 is always empty.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push({ line, cells: Array.from(values, (value) => value ?? null) });
    });
    return { name: tab.name, rows };
  });
  return { fileName: file.name, tabs };
}

/** Hands a file to the browser to save, as a download. */
export function downloadWorkbook(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has been handled: revoking at once can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
