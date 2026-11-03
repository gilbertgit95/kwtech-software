import {
  countSheetPlan,
  matchSheets,
  planSheetImport,
  prepareSheetCell,
  prepareSheetValue,
  readSheet,
  type SheetColumn,
  type SheetMatchKey,
  type SheetPlanInput,
  type SheetSpec,
  sheetReadMe,
} from '../src/spreadsheet.js';

const text = (header: string, extra: Partial<SheetColumn> = {}): SheetColumn => ({
  key: header.toLowerCase(),
  header,
  kind: 'text',
  example: 'x',
  help: 'h',
  ...extra,
});
const cellIn = (column: SheetColumn, raw: unknown) => prepareSheetValue(column, raw);

describe('cells, as a workbook reader hands them back', () => {
  it('takes text, numbers, yes/no and dates as they are, and empty as null', () => {
    expect(prepareSheetCell('Latte')).toEqual({ value: 'Latte' });
    expect(prepareSheetCell(12.5)).toEqual({ value: 12.5 });
    expect(prepareSheetCell(true)).toEqual({ value: true });
    expect(prepareSheetCell(null)).toEqual({ value: null });
    expect(prepareSheetCell(undefined)).toEqual({ value: null });
  });

  it('reads a formula as its result, styled text as its words, and a link as its text', () => {
    expect(prepareSheetCell({ formula: '10+2.5', result: 12.5 })).toEqual({ value: 12.5 });
    expect(prepareSheetCell({ richText: [{ text: 'Iced ', font: { bold: true } }, { text: 'tea' }] })).toEqual({
      value: 'Iced tea',
    });
    expect(prepareSheetCell({ text: 'Menu', hyperlink: 'https://example.com' })).toEqual({ value: 'Menu' });
  });

  it('⚠ refuses a formula with no result rather than reading it as empty, and a cell showing an error', () => {
    expect(prepareSheetCell({ formula: '10+2.5' })).toHaveProperty('refused');
    expect(prepareSheetCell({ error: '#N/A' })).toEqual({ refused: 'This cell shows an error (#N/A).' });
    expect(prepareSheetCell({ something: 'else' })).toHaveProperty('refused');
  });
});

describe('column kinds', () => {
  it('text: trims, reads a typed number as its digits, and keeps to its length', () => {
    expect(cellIn(text('Name'), '  Latte  ')).toEqual({ value: 'Latte' });
    expect(cellIn(text('Code'), 7)).toEqual({ value: '7' });
    expect(cellIn(text('Name', { maxLength: 3 }), 'Latte')).toEqual({ refused: 'At most 3 characters.' });
  });

  it('empty is null, unless the column is required', () => {
    expect(cellIn(text('Name'), '   ')).toEqual({ value: null });
    expect(cellIn(text('Name', { required: true }), '')).toEqual({ refused: 'Name is required.' });
  });

  it('⚠ refuses a date in any column: Excel made it, the person did not type it', () => {
    expect(cellIn(text('Code'), new Date('2026-03-04T00:00:00Z'))).toHaveProperty('refused');
  });

  it('integer: a whole number, typed or as text', () => {
    const column = text('Sort order', { kind: 'integer' });
    expect(cellIn(column, 3)).toEqual({ value: 3 });
    expect(cellIn(column, '1,200')).toEqual({ value: 1200 });
    expect(cellIn(column, 2.5)).toEqual({ refused: 'Write a whole number.' });
    expect(cellIn(column, 'three')).toEqual({ refused: 'Write a whole number.' });
    expect(cellIn(column, '-2')).toEqual({ value: -2 });
  });

  it('⚠ integer: refuses text that Number() would read as a number nobody typed', () => {
    const column = text('Sort order', { kind: 'integer' });
    for (const typed of ['2,5', '1,2,3', '1e3', '0x10', '12,00', ' ', 'Infinity', '1.0']) {
      expect(cellIn(column, typed)).toEqual(typed.trim() ? { refused: 'Write a whole number.' } : { value: null });
    }
  });

  it('money: pesos to centavos, as a number or as text with ₱ and thousands commas', () => {
    const price = text('Price', { kind: 'money' });
    expect(cellIn(price, 12.5)).toEqual({ value: 1250 });
    expect(cellIn(price, 0.07)).toEqual({ value: 7 });
    expect(cellIn(price, '12.50')).toEqual({ value: 1250 });
    expect(cellIn(price, '₱1,250.00')).toEqual({ value: 125000 });
    expect(cellIn(price, 0)).toEqual({ value: 0 });
  });

  it('⚠ money: never rounds a third decimal, and refuses negatives and words', () => {
    const price = text('Price', { kind: 'money' });
    expect(cellIn(price, 12.505)).toEqual({ refused: 'At most 2 decimals (centavos).' });
    expect(cellIn(price, '12.505')).toHaveProperty('refused');
    expect(cellIn(price, -1)).toHaveProperty('refused');
    expect(cellIn(price, 'P12.50')).toHaveProperty('refused');
    expect(cellIn(price, '1,25.00')).toHaveProperty('refused');
    expect(cellIn(price, true)).toHaveProperty('refused');
  });

  it('yes/no: the words people use', () => {
    const archived = text('Archived', { kind: 'yes_no' });
    for (const yes of ['Yes', 'y', 'TRUE', '1', 'x', true]) expect(cellIn(archived, yes)).toEqual({ value: true });
    for (const no of ['No', 'n', 'false', '0', 0, false]) expect(cellIn(archived, no)).toEqual({ value: false });
    expect(cellIn(archived, 'maybe')).toEqual({ refused: 'Write Yes or No.' });
  });

  it('choice: any case, read back as declared', () => {
    const kind = text('Kind', { kind: 'choice', choices: ['product', 'service'] });
    expect(cellIn(kind, 'Service')).toEqual({ value: 'service' });
    expect(cellIn(kind, 'thing')).toEqual({ refused: 'Choose one of: product, service.' });
  });
});

const ITEMS: SheetSpec<'code' | 'name' | 'price' | 'archived'> = {
  name: 'Items',
  help: 'One row per item.',
  columns: [
    { key: 'code', header: 'Code', kind: 'text', textFormat: true, example: '007', help: 'Optional.' },
    { key: 'name', header: 'Name', kind: 'text', required: true, example: 'Latte', help: 'Required.' },
    { key: 'price', header: 'Price', kind: 'money', required: true, example: 120, help: 'In pesos.' },
    { key: 'archived', header: 'Archived', kind: 'yes_no', example: 'No', help: 'Yes hides it.' },
  ],
};

describe('reading a sheet', () => {
  it('matches headings loosely and in any order, and ignores a column it does not know', () => {
    const reading = readSheet(ITEMS, [
      { line: 1, cells: ['price', 'Notes', ' NAME ', 'code'] },
      { line: 2, cells: [120, 'ignore me', 'Latte', '007'] },
    ]);
    expect(reading.fatal).toBeNull();
    expect(reading.rows).toEqual([
      { line: 2, values: { code: '007', name: 'Latte', price: 12000, archived: null }, problems: [] },
    ]);
  });

  it('skips blank rows and keeps the row numbers Excel shows', () => {
    const reading = readSheet(ITEMS, [
      { line: 1, cells: ['Name', 'Price'] },
      { line: 2, cells: ['Latte', 120] },
      { line: 3, cells: ['', null] },
      { line: 7, cells: ['Mocha', 130] },
    ]);
    expect(reading.rows.map((row) => row.line)).toEqual([2, 7]);
  });

  it('reads every row, and puts each problem on its row and column', () => {
    const reading = readSheet(ITEMS, [
      { line: 1, cells: ['Name', 'Price', 'Archived'] },
      { line: 2, cells: ['', 'free', 'maybe'] },
      { line: 3, cells: ['Mocha', 130, 'No'] },
    ]);
    expect(reading.rows[0]?.problems).toEqual([
      { sheet: 'Items', line: 2, column: 'Name', message: 'Name is required.' },
      { sheet: 'Items', line: 2, column: 'Price', message: 'Write an amount in pesos, like 12.50.' },
      { sheet: 'Items', line: 2, column: 'Archived', message: 'Write Yes or No.' },
    ]);
    expect(reading.rows[1]?.problems).toEqual([]);
  });

  it('⚠ refuses the whole sheet when a required heading is missing, or a heading is there twice', () => {
    expect(readSheet(ITEMS, [{ line: 1, cells: ['Name'] }]).fatal?.message).toBe('Missing heading(s): Price.');
    expect(readSheet(ITEMS, [{ line: 1, cells: ['Name', 'Price', 'name'] }]).fatal?.message).toBe(
      'The heading “name” appears twice.',
    );
    expect(readSheet(ITEMS, []).fatal?.message).toMatch(/empty/);
  });
});

describe('which sheets a workbook has', () => {
  it('matches tab names loosely, and ⚠ lists a missing one rather than reading it as empty', () => {
    const specs = [{ name: 'Items' }, { name: 'Order types' }, { name: 'Categories' }];
    const { found, missing } = matchSheets(specs, ['items', 'Order_Types', 'Read me']);
    expect(found).toEqual([
      { spec: { name: 'Items' }, tab: 'items' },
      { spec: { name: 'Order types' }, tab: 'Order_Types' },
    ]);
    expect(missing).toEqual([{ name: 'Categories' }]);
  });
});

describe('the Read me sheet', () => {
  it('lists each sheet and, for each column, whether it is required, what it holds and how to fill it', () => {
    const rows = sheetReadMe('POS setup', [ITEMS]);
    expect(rows[0]).toEqual(['POS setup']);
    expect(rows).toContainEqual(['Items', 'One row per item.']);
    expect(rows).toContainEqual(['Price', 'Yes', 'Pesos, like 12.50', 'In pesos.']);
    expect(rows).toContainEqual(['Archived', 'No', 'Yes or No', 'Yes hides it.']);
  });
});

// ── the plan ─────────────────────────────────────────────────────────────────

interface Row {
  code: string | null;
  name: string;
  price: number;
}
interface Existing extends Row {
  id: string;
  archived: boolean;
}

const keyOf = (row: Row): SheetMatchKey => ({ code: row.code, name: row.name.toLowerCase() });

function plan(rows: Row[], existing: Existing[], extra: Partial<SheetPlanInput<Row, Existing>> = {}) {
  return planSheetImport<Row, Existing>({
    sheet: 'Items',
    rows: rows.map((row, index) => ({ line: index + 2, row })),
    existing,
    rowKey: keyOf,
    existingKey: keyOf,
    isUnchanged: (row, current) => row.name === current.name && row.price === current.price && !current.archived,
    isArchived: (current) => current.archived,
    mode: 'merge',
    ...extra,
  });
}

const LATTE: Existing = { id: 'i1', code: 'LAT', name: 'Latte', price: 12000, archived: false };
const MOCHA: Existing = { id: 'i2', code: null, name: 'Mocha', price: 13000, archived: false };
const OLD: Existing = { id: 'i3', code: 'OLD', name: 'Old blend', price: 9000, archived: true };

describe('the import plan', () => {
  it('creates, updates and leaves alone, finding a row by its code', () => {
    const result = plan(
      [
        { code: 'LAT', name: 'Latte', price: 12500 },
        { code: 'TEA', name: 'Tea', price: 8000 },
        { code: null, name: 'Mocha', price: 13000 },
      ],
      [LATTE, MOCHA],
    );
    expect(result.problems).toEqual([]);
    expect(result.steps.map((step) => [step.kind, step.line])).toEqual([
      ['update', 2],
      ['create', 3],
      ['unchanged', 4],
    ]);
  });

  it('finds a row with no code by its name, ignoring case', () => {
    const result = plan([{ code: null, name: 'MOCHA', price: 14000 }], [LATTE, MOCHA]);
    expect(result.steps).toEqual([
      { kind: 'update', line: 2, row: { code: null, name: 'MOCHA', price: 14000 }, existing: MOCHA },
    ]);
  });

  it('⚠ treats a row WITH a code as new when the code is new, even if its name is taken', () => {
    const result = plan([{ code: 'LAT2', name: 'Latte', price: 1 }], [LATTE]);
    expect(result.steps.map((step) => step.kind)).toEqual(['create']);
  });

  it('⚠ never guesses between two existing rows with the name: an error on the row', () => {
    const twin = { ...MOCHA, id: 'i9', code: 'MOC2' };
    const result = plan([{ code: null, name: 'Mocha', price: 1 }], [MOCHA, twin]);
    expect(result.steps).toEqual([]);
    expect(result.problems).toEqual([
      {
        sheet: 'Items',
        line: 2,
        column: null,
        message: '2 existing rows have this name. Add the code to say which one.',
      },
    ]);
  });

  it('⚠ refuses one thing twice in the file — by code, or by name with no code — on every copy', () => {
    const result = plan(
      [
        { code: 'TEA', name: 'Tea', price: 1 },
        { code: null, name: 'Cake', price: 1 },
        { code: 'TEA', name: 'Green tea', price: 2 },
        { code: null, name: 'cake', price: 2 },
      ],
      [],
    );
    expect(result.steps).toEqual([]);
    expect(result.problems.map((problem) => [problem.line, problem.message])).toEqual([
      [2, 'The code TEA is on more than one row (rows 2, 4).'],
      [3, 'This name is on more than one row (rows 3, 5).'],
      [4, 'The code TEA is on more than one row (rows 2, 4).'],
      [5, 'This name is on more than one row (rows 3, 5).'],
    ]);
  });

  it('refuses two rows that find the same existing row, one by code and one by name', () => {
    const result = plan(
      [
        { code: 'LAT', name: 'Latte', price: 1 },
        { code: null, name: 'Latte', price: 2 },
      ],
      [LATTE],
    );
    expect(result.steps).toEqual([]);
    expect(result.problems.map((problem) => problem.message)).toEqual([
      'Rows 2, 3 are the same existing row. Keep one.',
      'Rows 2, 3 are the same existing row. Keep one.',
    ]);
  });

  it('⚠ never guesses between two existing rows that share a code, and archives neither', () => {
    const copy: Existing = { ...LATTE, id: 'i8', name: 'Latte copy' };
    const result = plan([{ code: 'LAT', name: 'Latte', price: 1 }], [LATTE, copy, MOCHA], { mode: 'replace' });
    expect(result.steps).toEqual([]);
    expect(result.problems.map((problem) => problem.message)).toEqual([
      '2 existing rows have the code LAT. Give each its own code first.',
    ]);
    expect(result.archive).toEqual([MOCHA]);
  });

  it('Add and update never archives', () => {
    expect(plan([], [LATTE, MOCHA]).archive).toEqual([]);
  });

  it('Replace archives what the file left out — but not what is archived already', () => {
    const result = plan([{ code: 'LAT', name: 'Latte', price: 12000 }], [LATTE, MOCHA, OLD], { mode: 'replace' });
    expect(result.archive).toEqual([MOCHA]);
  });

  it('⚠ Replace never archives what a row with a problem meant — read, twice, ambiguous or held', () => {
    const twin = { ...MOCHA, id: 'i9', code: 'MOC2' };
    const tea: Existing = { id: 'i4', code: 'TEA', name: 'Tea', price: 8000, archived: false };
    const cake: Existing = { id: 'i5', code: 'CAKE', name: 'Cake', price: 5000, archived: false };
    const result = plan(
      [
        { code: 'TEA', name: 'Tea', price: 1 },
        { code: 'TEA', name: 'Tea again', price: 2 },
        { code: null, name: 'Mocha', price: 3 },
      ],
      [LATTE, MOCHA, twin, tea, cake],
      // Row 9's price did not read, but its code did: the cake is kept.
      { mode: 'replace', held: [{ code: 'CAKE', name: 'cake' }] },
    );
    expect(result.archive).toEqual([LATTE]);
  });

  it('⚠ is idempotent: the file applied, the same file again changes nothing', () => {
    const file: Row[] = [
      { code: 'LAT', name: 'Latte', price: 12500 },
      { code: null, name: 'Mocha', price: 13000 },
    ];
    const after: Existing[] = [{ ...LATTE, price: 12500 }, MOCHA];
    const again = plan(file, after, { mode: 'replace' });
    expect(again.steps.map((step) => step.kind)).toEqual(['unchanged', 'unchanged']);
    expect(again.archive).toEqual([]);
  });

  it('counts a plan for the preview, errors as ROWS with problems', () => {
    const result = plan(
      [
        { code: 'LAT', name: 'Latte', price: 1 },
        { code: 'TEA', name: 'Tea', price: 1 },
        { code: null, name: 'Mocha', price: 13000 },
      ],
      [LATTE, MOCHA, { ...OLD, archived: false }],
      { mode: 'replace' },
    );
    const readProblems = [
      { sheet: 'Items', line: 9, column: 'Price', message: 'x' },
      { sheet: 'Items', line: 9, column: 'Name', message: 'y' },
    ];
    expect(countSheetPlan(result, readProblems)).toEqual({ create: 1, update: 1, unchanged: 1, archive: 1, errors: 1 });
  });
});
