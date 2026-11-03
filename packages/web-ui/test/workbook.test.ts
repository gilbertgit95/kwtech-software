import { readWorkbook, writeWorkbook } from '../src/react/workbook.js';
import {
  checkWorkbookFile,
  columnLetter,
  type ImportWizardPreview,
  importBlocker,
  importButtonLabel,
  importSummary,
  problemPlace,
  WORKBOOK_MAX_BYTES,
  type WorkbookSheet,
  workbookCell,
  workbookDropdown,
  workbookFileName,
} from '../src/react/workbook-rules.js';

const CATEGORIES: WorkbookSheet = {
  name: 'Categories',
  columns: [{ key: 'name', header: 'Name', kind: 'text', required: true, example: 'Drinks' }],
};

const ITEMS: WorkbookSheet = {
  name: 'Items',
  columns: [
    { key: 'code', header: 'Code', kind: 'text', textFormat: true, example: '007' },
    { key: 'name', header: 'Name', kind: 'text', required: true, example: 'Latte' },
    { key: 'kind', header: 'Kind', kind: 'choice', choices: ['product', 'service'], example: 'product' },
    {
      key: 'category',
      header: 'Category',
      kind: 'text',
      listFrom: { sheet: 'Categories', header: 'Name' },
      example: 'Drinks',
    },
    { key: 'price', header: 'Price', kind: 'money', required: true, example: 120 },
    { key: 'archived', header: 'Archived', kind: 'yes_no', example: 'No' },
  ],
};

describe('which files open', () => {
  it('takes .xlsx, and says what to do with anything else', () => {
    expect(checkWorkbookFile({ name: 'Setup.XLSX', size: 10 })).toBeNull();
    expect(checkWorkbookFile({ name: 'setup.xls', size: 10 })).toMatch(/save it as \.xlsx/);
    expect(checkWorkbookFile({ name: 'setup.csv', size: 10 })).toBe('Choose an Excel file (.xlsx).');
    expect(checkWorkbookFile({ name: 'setup.xlsx', size: 0 })).toBe('This file is empty.');
    expect(checkWorkbookFile({ name: 'setup.xlsx', size: WORKBOOK_MAX_BYTES + 1 })).toMatch(/too large/);
  });
});

describe('cells written', () => {
  it('writes money in pesos and yes/no as words, from the module’s units', () => {
    expect(workbookCell({ kind: 'money' }, 1250)).toBe(12.5);
    expect(workbookCell({ kind: 'money' }, 7)).toBe(0.07);
    expect(workbookCell({ kind: 'yes_no' }, true)).toBe('Yes');
    expect(workbookCell({ kind: 'yes_no' }, false)).toBe('No');
    expect(workbookCell({ kind: 'text' }, '007')).toBe('007');
    expect(workbookCell({ kind: 'integer' }, 3)).toBe(3);
    expect(workbookCell({ kind: 'money' }, null)).toBeNull();
  });

  it('offers dropdowns for yes/no, choices and another tab’s column', () => {
    const sheets = [CATEGORIES, ITEMS];
    const [, , kind, category, , archived] = ITEMS.columns;
    if (!kind || !category || !archived) throw new Error('the items sheet has its columns');
    expect(workbookDropdown(archived, sheets)).toBe('"Yes,No"');
    expect(workbookDropdown(kind, sheets)).toBe('"product,service"');
    expect(workbookDropdown(category, sheets, 1001)).toBe("'Categories'!$A$2:$A$1001");
    expect(workbookDropdown({ kind: 'text' }, sheets)).toBeNull();
  });

  it('⚠ leaves out a dropdown Excel would reject: a list past 255 characters, or another tab that is not written', () => {
    const long = Array.from({ length: 60 }, (_, index) => `choice-${index}`);
    expect(workbookDropdown({ kind: 'choice', choices: long }, [])).toBeNull();
    expect(workbookDropdown({ kind: 'text', listFrom: { sheet: 'Categories', header: 'Name' } }, [ITEMS])).toBeNull();
  });

  it('names columns as Excel does', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual([
      'A',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ]);
  });

  it('names the file by what, whose and the workspace’s day', () => {
    expect(workbookFileName('POS setup', 'Kwtech Printing IB', '2026-11-03')).toBe(
      'pos-setup-kwtech-printing-ib-2026-11-03.xlsx',
    );
    expect(workbookFileName('POS setup', 'Café Ñino!', '2026-11-03')).toBe('pos-setup-cafe-nino-2026-11-03.xlsx');
  });
});

describe('a workbook, written and read back', () => {
  async function asFile(blob: Blob): Promise<Blob & { name: string }> {
    return Object.assign(new Blob([await blob.arrayBuffer()]), { name: 'setup.xlsx' });
  }

  it('writes the template — Read me first, then each tab with its example row — and reads it back', async () => {
    const blob = await writeWorkbook({
      readMe: [['POS setup'], [], ['Items', 'One row per item.']],
      sheets: [{ sheet: CATEGORIES }, { sheet: ITEMS }],
    });
    const reading = await readWorkbook(await asFile(blob));
    expect(reading.tabs.map((tab) => tab.name)).toEqual(['Read me', 'Categories', 'Items']);
    const items = reading.tabs[2];
    expect(items?.rows).toEqual([
      { line: 1, cells: ['Code', 'Name', 'Kind', 'Category', 'Price', 'Archived'] },
      { line: 2, cells: ['007', 'Latte', 'product', 'Drinks', 120, 'No'] },
    ]);
  });

  it('writes the module’s rows in pesos, and keeps a code’s leading zeros', async () => {
    const blob = await writeWorkbook({
      sheets: [
        {
          sheet: ITEMS,
          rows: [
            { code: '0042', name: 'Latte', kind: 'product', category: null, price: 12050, archived: false },
            { code: null, name: 'Tea', kind: 'service', category: 'Drinks', price: 7, archived: true },
          ],
        },
      ],
    });
    const items = (await readWorkbook(await asFile(blob))).tabs[0];
    expect(items?.rows.slice(1)).toEqual([
      { line: 2, cells: ['0042', 'Latte', 'product', null, 120.5, 'No'] },
      { line: 3, cells: [null, 'Tea', 'service', 'Drinks', 0.07, 'Yes'] },
    ]);
  });

  it('refuses a file that is not a workbook, in words', async () => {
    const notExcel = Object.assign(new Blob(['hello']), { name: 'setup.xlsx' });
    await expect(readWorkbook(notExcel)).rejects.toThrow(/could not be read as an Excel workbook/);
    await expect(readWorkbook(Object.assign(new Blob(['x']), { name: 'setup.csv' }))).rejects.toThrow(
      'Choose an Excel file (.xlsx).',
    );
  });
});

// ── the wizard's rules ──────────────────────────────────────────────────────

const counts = (patch: Partial<ImportWizardPreview['sheets'][number]['counts']> = {}) => ({
  create: 0,
  update: 0,
  unchanged: 0,
  archive: 0,
  errors: 0,
  ...patch,
});
const preview = (sheets: ImportWizardPreview['sheets'], fatal: string[] = []): ImportWizardPreview => ({
  sheets,
  fatal,
});
const sheet = (name: string, patch: Partial<ImportWizardPreview['sheets'][number]['counts']>) => ({
  name,
  missing: false,
  counts: counts(patch),
  problems: [],
  archived: [],
});

describe('the import wizard’s rules', () => {
  it('summarises a sheet by what is not zero', () => {
    expect(importSummary(counts({ create: 12, update: 3, unchanged: 1, errors: 2 }))).toBe(
      '12 new, 3 updated, 1 unchanged, 2 with errors',
    );
    expect(importSummary(counts({ archive: 4 }))).toBe('4 to archive');
    expect(importSummary(counts())).toBe('Nothing in this sheet');
  });

  it('⚠ blocks an import with errors unless the person chose to skip those rows', () => {
    const withErrors = preview([sheet('Items', { create: 2, errors: 1 })]);
    expect(importBlocker(withErrors, false)).toBe('Fix the rows with errors, or choose to skip them.');
    expect(importBlocker(withErrors, true)).toBeNull();
  });

  it('⚠ never lets a problem with the whole file be skipped', () => {
    expect(importBlocker(preview([sheet('Items', { create: 2 })], ['Items: Missing heading(s): Price.']), true)).toBe(
      'Fix the problems with the file first.',
    );
  });

  it('says when there is nothing to change — the same file imported again', () => {
    expect(importBlocker(preview([sheet('Items', { unchanged: 5 })]), false)).toBe(
      'Nothing to change: the store already matches this file.',
    );
  });

  it('labels the button by the changes it makes, archives included', () => {
    expect(
      importButtonLabel(preview([sheet('Items', { create: 2, update: 1 }), sheet('Categories', { archive: 1 })])),
    ).toBe('Import 4 changes');
    expect(importButtonLabel(preview([sheet('Items', { create: 1, unchanged: 9 })]))).toBe('Import 1 change');
  });

  it('places a problem where the person will look for it', () => {
    expect(problemPlace({ line: 7, column: 'Price' })).toBe('Row 7 · Price');
    expect(problemPlace({ line: 7, column: null })).toBe('Row 7');
    expect(problemPlace({ line: null, column: null })).toBe('The whole sheet');
  });
});
