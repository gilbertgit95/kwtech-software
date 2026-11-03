/**
 * SPREADSHEET IMPORT AND EXPORT — the part every module's would share (issue #35).
 *
 * A module that lets people move its setup in and out of Excel declares its
 * SHEETS as data (`SheetSpec`): the columns, what each holds, an example and a
 * line of help. From that one declaration come the template, the Read me sheet,
 * the reading of a filled-in file and the import plan. The module adds only
 * what is its own: its rules for a valid row, and the mutation that applies the
 * plan, which checks every row again on the server.
 *
 * ⚠ PURE: no file APIs and no library. Reading and writing the `.xlsx` itself
 * is the browser's job (`@kwtech/web-ui`); here a sheet is rows of cell values,
 * so every rule is tested with a literal. The cell values are the shapes a
 * workbook reader hands back — a formula with its result, styled text, a link —
 * described structurally, so this package depends on no reader.
 *
 * ⚠ NOTHING HERE IS ABOUT ANY ONE MODULE. "Code" and "name" are the two ways
 * any catalogue row is found again; what they are called on a sheet, and what
 * makes two names the same, the module says.
 */

// ── cells ───────────────────────────────────────────────────────────────────

/** A cell as the rules read it: nothing, text, a number, a yes/no, or a date. */
export type SheetCell = string | number | boolean | Date | null;

/**
 * A raw cell from a workbook reader → a plain value, or why it cannot be one.
 *
 * Readers hand back more than primitives, and a person's file has all of them:
 *
 *   { formula, result }  a formula — its RESULT is what the person sees
 *   { richText: [...] }  text with some words bold or coloured
 *   { text, hyperlink }  a link
 *   { error: '#N/A' }    a formula that failed
 *
 * ⚠ A formula with no result is refused, not read as empty: a file written by a
 * program rather than saved by Excel carries no results, and an empty price
 * would be read as "no price" — a different, wrong, value.
 */
export function prepareSheetCell(raw: unknown): { value: SheetCell } | { refused: string } {
  if (raw === null || raw === undefined) return { value: null };
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return { value: raw };
  if (raw instanceof Date) return { value: raw };
  if (typeof raw !== 'object') return { refused: 'This cell holds something that is not text or a number.' };

  const cell = raw as { formula?: unknown; result?: unknown; richText?: unknown; text?: unknown; error?: unknown };
  if (cell.error !== undefined) return { refused: `This cell shows an error (${String(cell.error)}).` };
  if ('formula' in cell || 'sharedFormula' in cell) {
    if (cell.result === undefined || cell.result === null) {
      return { refused: 'This cell is a formula with no value yet. Open the file in Excel and save it again.' };
    }
    return prepareSheetCell(cell.result);
  }
  if (Array.isArray(cell.richText)) {
    return { value: cell.richText.map((run) => String((run as { text?: unknown }).text ?? '')).join('') };
  }
  if (cell.text !== undefined) return prepareSheetCell(cell.text);
  return { refused: 'This cell holds something that is not text or a number.' };
}

// ── columns and sheets ──────────────────────────────────────────────────────

/**
 * What a column holds:
 *
 *   text     words; a number typed here is read as its digits ("7")
 *   integer  a whole number
 *   money    an amount in pesos with at most 2 decimals, read as CENTAVOS
 *            (12.50 → 1250), the unit every amount in this app is stored in
 *   yes_no   Yes or No
 *   choice   one of `choices`, any case, read as the choice as declared
 */
export type SheetColumnKind = 'text' | 'integer' | 'money' | 'yes_no' | 'choice';

export interface SheetColumn<K extends string = string> {
  /** What the module calls this column. Never shown. */
  key: K;
  /** The heading on the sheet. Matched loosely on import: case, spaces, `_` and `-` do not matter. */
  header: string;
  kind: SheetColumnKind;
  /** A file without this heading is refused; a row with it empty is an error on that row. */
  required?: boolean;
  /** For `choice`: the allowed values, as they should read. The template offers them as a dropdown. */
  choices?: readonly string[];
  /**
   * For `text`: the values are another tab's column — an item's Category is one
   * of the Names on the Categories tab. The template offers them as a dropdown
   * read from that tab, so it grows as the person adds rows there. ⚠ Only a
   * hint to the person: the MODULE checks that the value is one of them, since
   * the other tab may be missing from the file or the value already stored.
   */
  listFrom?: { sheet: string; header: string };
  /** For `text`: the most characters it may hold. */
  maxLength?: number;
  /**
   * For `text`: keep the cell as TEXT in the template. ⚠ For codes — Excel
   * turns a typed 007 into the number 7, and the zeros cannot be got back.
   */
  textFormat?: boolean;
  /** The template's example row. */
  example: string | number | boolean | null;
  /** One line for the Read me sheet: what goes here and how. */
  help: string;
}

export interface SheetSpec<K extends string = string> {
  /** The tab's name. Matched loosely on import, as headings are. */
  name: string;
  /** One line for the Read me sheet: what a row of this sheet is. */
  help: string;
  columns: readonly SheetColumn<K>[];
}

/** A typed value: text and choices as strings, integers and money as numbers, yes/no as booleans. */
export type SheetValue = string | number | boolean | null;

/** One problem, where the person will find it: the sheet, the row number they see, and the heading. */
export interface SheetProblem {
  sheet: string;
  /** The row as Excel numbers it. Null for a problem with the whole sheet. */
  line: number | null;
  /** The column's heading, or null for the whole row. */
  column: string | null;
  message: string;
}

/** A row of the file as the reader found it: its row number in Excel, and its cells left to right. */
export interface SheetRowInput {
  line: number;
  cells: readonly unknown[];
}

/** One row read: its typed values, by column key, and what is wrong with it. */
export interface SheetRow<K extends string = string> {
  line: number;
  values: Record<K, SheetValue>;
  problems: SheetProblem[];
}

export interface SheetReading<K extends string = string> {
  rows: SheetRow<K>[];
  /** Wrong with the whole sheet (a heading missing, a heading twice). Rows are then empty. */
  fatal: SheetProblem | null;
}

/** Headings and tab names compared as people write them: "Sort order", "sort_order" and "SortOrder" are one. */
export function sheetNameKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, '');
}

const YES = new Set(['yes', 'y', 'true', '1', 'x']);
const NO = new Set(['no', 'n', 'false', '0']);

/** The money a cell may hold: digits, thousands commas, at most 2 decimals, an optional leading ₱. */
const MONEY_TEXT = /^₱?\s*(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/u;

/**
 * A whole number as text: digits, optional thousands commas IN THEIR PLACES,
 * an optional minus. ⚠ `Number()` alone would read "2,5" as 25, "1e3" as 1000
 * and "0x10" as 16 — numbers nobody typed.
 */
const INTEGER_TEXT = /^-?(\d{1,3}(,\d{3})+|\d+)$/u;

/**
 * One cell → the column's typed value, or why it is not one. Empty is `null`
 * (the module decides what a blank means); a required column refuses it.
 */
export function prepareSheetValue(column: SheetColumn, raw: unknown): { value: SheetValue } | { refused: string } {
  const read = prepareSheetCell(raw);
  if ('refused' in read) return read;
  const cell = typeof read.value === 'string' ? read.value.trim() : read.value;
  if (cell === null || cell === '') {
    return column.required ? { refused: `${column.header} is required.` } : { value: null };
  }
  // ⚠ No column holds a date. Excel turns "3-4" or "1/2" into one, and a code or
  // a name read back as a date string is not what the person typed.
  if (cell instanceof Date) {
    return { refused: `Excel read this as a date. Format the cell as text and type it again.` };
  }

  switch (column.kind) {
    case 'text': {
      const text = String(cell);
      if (column.maxLength !== undefined && text.length > column.maxLength) {
        return { refused: `At most ${column.maxLength} characters.` };
      }
      return { value: text };
    }
    case 'integer': {
      const refused = { refused: 'Write a whole number.' };
      if (typeof cell === 'boolean') return refused;
      if (typeof cell === 'string' && !INTEGER_TEXT.test(cell)) return refused;
      const number = typeof cell === 'number' ? cell : Number(cell.replace(/,/gu, ''));
      return Number.isSafeInteger(number) ? { value: number } : refused;
    }
    case 'money':
      return prepareMoney(cell);
    case 'yes_no': {
      const word = String(cell).toLowerCase();
      if (cell === true || YES.has(word)) return { value: true };
      if (cell === false || NO.has(word)) return { value: false };
      return { refused: 'Write Yes or No.' };
    }
    case 'choice': {
      const choices = column.choices ?? [];
      const found = choices.find((choice) => choice.toLowerCase() === String(cell).toLowerCase());
      return found === undefined ? { refused: `Choose one of: ${choices.join(', ')}.` } : { value: found };
    }
  }
}

/**
 * Pesos → centavos. ⚠ NEVER ROUNDED: 12.505 is refused rather than read as
 * 12.51 or 12.50, because either guess is a price nobody typed. A negative
 * amount is refused too: setup holds prices and costs, never a debt.
 */
function prepareMoney(cell: string | number | boolean): { value: number } | { refused: string } {
  const message = 'Write an amount in pesos, like 12.50.';
  if (typeof cell === 'boolean') return { refused: message };
  if (typeof cell === 'string') {
    if (!MONEY_TEXT.test(cell)) return { refused: message };
    return prepareMoney(Number(cell.replace(/[₱,\s]/gu, '')));
  }
  if (!Number.isFinite(cell) || cell < 0) return { refused: message };
  const centavos = Math.round(cell * 100);
  // Floating point: 12.5 * 100 is exactly 1250, but 0.07 * 100 is 7.000000000000001.
  if (Math.abs(cell * 100 - centavos) > 1e-6) return { refused: 'At most 2 decimals (centavos).' };
  if (!Number.isSafeInteger(centavos)) return { refused: message };
  return { value: centavos };
}

/**
 * A sheet's rows (the heading row first) → typed rows, each with its problems.
 *
 * - Headings are matched loosely and in any order; a column the spec does not
 *   know is ignored, so a person's notes column breaks nothing.
 * - ⚠ A REQUIRED HEADING MISSING, or any heading twice, refuses the whole
 *   sheet: every row would be read wrong, so none is read.
 * - Blank rows are skipped: they are what a spreadsheet leaves behind.
 * - EVERY row is read and returned, valid or not, so a person fixes a file in
 *   one pass rather than one error at a time.
 */
export function readSheet<K extends string>(spec: SheetSpec<K>, input: readonly SheetRowInput[]): SheetReading<K> {
  const problem = (message: string): SheetReading<K> => ({
    rows: [],
    fatal: { sheet: spec.name, line: null, column: null, message },
  });
  const [heading, ...body] = input;
  if (!heading) return problem('This sheet is empty: it needs its heading row.');

  const positions = new Map<string, number>();
  for (const [position, raw] of heading.cells.entries()) {
    const read = prepareSheetCell(raw);
    const text = 'value' in read && read.value !== null ? String(read.value) : '';
    const key = sheetNameKey(text);
    if (!key) continue;
    if (positions.has(key)) return problem(`The heading “${text.trim()}” appears twice.`);
    positions.set(key, position);
  }
  const missing = spec.columns.filter((column) => column.required && !positions.has(sheetNameKey(column.header)));
  if (missing.length > 0) {
    return problem(`Missing heading(s): ${missing.map((column) => column.header).join(', ')}.`);
  }

  const rows: SheetRow<K>[] = [];
  for (const row of body) {
    if (row.cells.every(isBlankCell)) continue;
    const values = {} as Record<K, SheetValue>;
    const problems: SheetProblem[] = [];
    for (const column of spec.columns) {
      const position = positions.get(sheetNameKey(column.header));
      const read = prepareSheetValue(column, position === undefined ? null : row.cells[position]);
      if ('refused' in read) {
        problems.push({ sheet: spec.name, line: row.line, column: column.header, message: read.refused });
        values[column.key] = null;
        continue;
      }
      values[column.key] = read.value;
    }
    rows.push({ line: row.line, values, problems });
  }
  return { rows, fatal: null };
}

function isBlankCell(raw: unknown): boolean {
  const read = prepareSheetCell(raw);
  if ('refused' in read) return false;
  return read.value === null || (typeof read.value === 'string' && read.value.trim() === '');
}

/**
 * Which of the module's sheets the workbook has, by tab name, matched loosely.
 *
 * ⚠ A SHEET MISSING FROM THE FILE IS LEFT ALONE, never read as empty: a person
 * who deleted the Categories tab did not ask for every category to be
 * archived. The import says which were skipped.
 */
export function matchSheets<S extends Pick<SheetSpec, 'name'>>(
  specs: readonly S[],
  tabNames: readonly string[],
): { found: { spec: S; tab: string }[]; missing: S[] } {
  const tabs = new Map(tabNames.map((tab) => [sheetNameKey(tab), tab]));
  const found: { spec: S; tab: string }[] = [];
  const missing: S[] = [];
  for (const spec of specs) {
    const tab = tabs.get(sheetNameKey(spec.name));
    if (tab === undefined) missing.push(spec);
    else found.push({ spec, tab });
  }
  return { found, missing };
}

/**
 * The Read me sheet's rows: each sheet, what a row of it is, then each column —
 * its heading, whether it must be filled, what it holds, and its help.
 */
export function sheetReadMe(title: string, specs: readonly SheetSpec[]): string[][] {
  const rows: string[][] = [[title], []];
  for (const spec of specs) {
    rows.push([spec.name, spec.help]);
    rows.push(['Column', 'Required', 'Holds', 'How to fill it']);
    for (const column of spec.columns) {
      rows.push([column.header, column.required ? 'Yes' : 'No', describeKind(column), column.help]);
    }
    rows.push([]);
  }
  return rows;
}

function describeKind(column: SheetColumn): string {
  switch (column.kind) {
    case 'text':
      if (column.listFrom) return `A ${column.listFrom.header} from the ${column.listFrom.sheet} sheet`;
      return column.maxLength === undefined ? 'Text' : `Text, at most ${column.maxLength} characters`;
    case 'integer':
      return 'A whole number';
    case 'money':
      return 'Pesos, like 12.50';
    case 'yes_no':
      return 'Yes or No';
    case 'choice':
      return `One of: ${(column.choices ?? []).join(', ')}`;
  }
}

// ── the import plan ─────────────────────────────────────────────────────────

/**
 * How a row is found again among what is already there: by its code, or —
 * when it has none — by its name. `name` is already a KEY (the module folds it
 * as it folds names everywhere, e.g. case-blind), and the module may scope it
 * ("this size's name within its item") by putting the scope into the key.
 */
export interface SheetMatchKey {
  code: string | null;
  name: string;
}

/**
 * Add and update (the default): rows in the file are created or updated, and
 * nothing else changes. Replace: as well, what the file does not have is
 * ARCHIVED — never deleted, so old orders still point at it.
 */
export type SheetImportMode = 'merge' | 'replace';

export type SheetPlanStep<R, E> =
  | { kind: 'create'; line: number; row: R }
  | { kind: 'update'; line: number; row: R; existing: E }
  | { kind: 'unchanged'; line: number; row: R; existing: E };

export interface SheetPlan<R, E> {
  steps: SheetPlanStep<R, E>[];
  /** Replace only: what the file left out, still live, to be archived. */
  archive: E[];
  problems: SheetProblem[];
}

export interface SheetPlanInput<R, E> {
  sheet: string;
  /** The rows to plan — only those that READ without a problem; the rest are already reported. */
  rows: readonly { line: number; row: R }[];
  existing: readonly E[];
  rowKey: (row: R) => SheetMatchKey;
  existingKey: (existing: E) => SheetMatchKey;
  /** Whether applying the row would change nothing. */
  isUnchanged: (row: R, existing: E) => boolean;
  /** Whether it is archived already: Replace never archives it twice. */
  isArchived: (existing: E) => boolean;
  mode: SheetImportMode;
  /**
   * The keys of rows that could NOT be read (a bad price, say) but still name
   * what they are — so Replace never archives the thing such a row was meant
   * to update. Without them, skipping a bad row would archive its item.
   */
  held?: readonly SheetMatchKey[];
}

/**
 * Sorts each row into create, update or unchanged, and — in Replace — lists
 * what will be archived. ⚠ NEVER A GUESS:
 *
 *   - A row WITH a code is found by its code. Not found, it is the row of that
 *     name that has NO code yet — a code being added — or else new. A row
 *     whose code differs is never claimed: that is another thing.
 *   - A row WITHOUT a code is found by its name. Two existing rows with that
 *     name: an error on the row, naming both — never "the first one".
 *   - Two rows of the file that are the same thing (one code, or one name
 *     with no code), or that find the same existing row: an error on each.
 *
 * The plan is the same for the same file and the same store, so importing a
 * file twice changes nothing the second time: every row is `unchanged`.
 */
export function planSheetImport<R, E>(input: SheetPlanInput<R, E>): SheetPlan<R, E> {
  /*
   * ⚠ EVERY ROW PER CODE, not the last one. A module normally keeps its codes
   * unique, but this planner cannot assume it: with two rows on one code,
   * keeping one would update it and let Replace archive the other.
   */
  const byCode = new Map<string, E[]>();
  const byName = new Map<string, E[]>();
  for (const existing of input.existing) {
    const key = input.existingKey(existing);
    if (key.code) byCode.set(key.code, [...(byCode.get(key.code) ?? []), existing]);
    byName.set(key.name, [...(byName.get(key.name) ?? []), existing]);
  }

  const problems: SheetProblem[] = [];
  const problem = (line: number, message: string) => problems.push({ sheet: input.sheet, line, column: null, message });
  /**
   * ⚠ What a row with a problem points at is NEVER archived: Replace archives
   * what the file left out, and a row the person meant, but wrote wrongly, did
   * not leave it out.
   */
  const kept = new Set<E>();
  const keep = (key: SheetMatchKey) => {
    const coded = key.code ? byCode.get(key.code) : undefined;
    // A code nobody has yet may be meant for a same-name row without one (below): keep those too.
    const matches = coded?.length
      ? coded
      : (byName.get(key.name) ?? []).filter((existing) => !key.code || !input.existingKey(existing).code);
    for (const existing of matches) kept.add(existing);
  };
  for (const key of input.held ?? []) keep(key);

  // The file against itself first: one thing twice is an error on every copy.
  const seen = new Map<string, number[]>();
  for (const { line, row } of input.rows) {
    const key = input.rowKey(row);
    const identity = key.code ? `code:${key.code}` : `name:${key.name}`;
    seen.set(identity, [...(seen.get(identity) ?? []), line]);
  }
  const twice = new Set<number>();
  for (const [identity, lines] of seen) {
    if (lines.length < 2) continue;
    const what = identity.startsWith('code:') ? `The code ${identity.slice(5)}` : 'This name';
    for (const line of lines) {
      twice.add(line);
      problem(line, `${what} is on more than one row (rows ${lines.join(', ')}).`);
    }
  }
  for (const { line, row } of input.rows) if (twice.has(line)) keep(input.rowKey(row));

  const found: { line: number; row: R; existing: E | null }[] = [];
  for (const { line, row } of input.rows) {
    if (twice.has(line)) continue;
    const key = input.rowKey(row);
    if (key.code) {
      const coded = byCode.get(key.code) ?? [];
      if (coded.length > 1) {
        problem(line, `${coded.length} existing rows have the code ${key.code}. Give each its own code first.`);
        keep(key);
        continue;
      }
      if (coded[0]) {
        found.push({ line, row, existing: coded[0] });
        continue;
      }
      /*
       * ⚠ A CODE ADDED TO A ROW THAT HAD NONE. Exported, given a code, imported
       * back: matching by code alone would create a SECOND row. So a new code
       * finds the row of that name that has NO code yet — never one with a
       * code of its own, which is a different thing. Two such rows: an error.
       */
      const uncoded = (byName.get(key.name) ?? []).filter((existing) => !input.existingKey(existing).code);
      if (uncoded.length > 1) {
        problem(
          line,
          `${uncoded.length} existing rows have this name and no code. Give them their codes one at a time.`,
        );
        keep(key);
        continue;
      }
      found.push({ line, row, existing: uncoded[0] ?? null });
      continue;
    }
    const named = byName.get(key.name) ?? [];
    if (named.length > 1) {
      problem(line, `${named.length} existing rows have this name. Add the code to say which one.`);
      keep(key);
      continue;
    }
    found.push({ line, row, existing: named[0] ?? null });
  }

  // Two rows of the file that found the SAME existing row (one by code, one by name).
  const claims = new Map<E, number[]>();
  for (const entry of found) {
    if (entry.existing !== null) claims.set(entry.existing, [...(claims.get(entry.existing) ?? []), entry.line]);
  }
  const steps: SheetPlanStep<R, E>[] = [];
  const matched = new Set<E>();
  for (const { line, row, existing } of found) {
    if (existing === null) {
      steps.push({ kind: 'create', line, row });
      continue;
    }
    const lines = claims.get(existing) ?? [];
    if (lines.length > 1) {
      problem(line, `Rows ${lines.join(', ')} are the same existing row. Keep one.`);
      kept.add(existing);
      continue;
    }
    matched.add(existing);
    steps.push({ kind: input.isUnchanged(row, existing) ? 'unchanged' : 'update', line, row, existing });
  }

  const archive =
    input.mode === 'replace'
      ? input.existing.filter(
          (existing) => !matched.has(existing) && !kept.has(existing) && !input.isArchived(existing),
        )
      : [];
  return { steps, archive, problems: problems.sort((a, b) => (a.line ?? 0) - (b.line ?? 0)) };
}

/** What a sheet's import will do, for the preview: "12 new, 3 updated, 1 unchanged, 2 with errors". */
export interface SheetPlanCounts {
  create: number;
  update: number;
  unchanged: number;
  archive: number;
  /** ROWS with at least one problem, not problems. */
  errors: number;
}

/** Counts a plan, and the rows that failed before it — reading and planning alike. */
export function countSheetPlan(
  plan: Pick<SheetPlan<unknown, unknown>, 'steps' | 'archive' | 'problems'>,
  readProblems: readonly SheetProblem[] = [],
): SheetPlanCounts {
  const counts: SheetPlanCounts = { create: 0, update: 0, unchanged: 0, archive: plan.archive.length, errors: 0 };
  for (const step of plan.steps) counts[step.kind] += 1;
  const lines = new Set([...plan.problems, ...readProblems].map((problem) => problem.line));
  counts.errors = lines.size;
  return counts;
}
