import { type DraftErrors, type FeatureDraft, validateDraftList } from './feature-draft.js';

/**
 * Turning a spreadsheet into drafts.
 *
 * Kept out of the React page and free of the file APIs on purpose: this half is
 * rows-in, drafts-out, so it can be tested with a literal array rather than a
 * Blob. The page owns reading the file; this owns understanding it.
 */

/** The columns an import file must carry, in any order and any case. */
export const IMPORT_COLUMNS = ['key', 'module', 'level', 'label', 'description', 'isPrivileged', 'tags'] as const;

export interface ImportedRow {
  /** 1-based line in the source file, INCLUDING the header — so it matches what the person sees. */
  line: number;
  draft: FeatureDraft;
  errors: DraftErrors;
}

export interface ImportResult {
  rows: ImportedRow[];
  /** Wrong at the file level rather than the row level: a missing column, an empty sheet. */
  fatal?: string;
}

/**
 * Maps a header row to column indexes.
 *
 * Case- and space-insensitive, because a spreadsheet handed to a person comes
 * back with "Key" and "Is Privileged" — refusing that would be refusing the
 * file for looking the way people make files look.
 */
function headerIndex(header: readonly string[]): Map<string, number> {
  const index = new Map<string, number>();
  header.forEach((cell, position) => {
    const normalised = String(cell ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]/g, '');
    if (normalised) index.set(normalised, position);
  });
  return index;
}

/** 'true', 'yes', '1', 'x' — the things people actually put in a boolean column. */
function toBoolean(value: string): boolean {
  return ['true', 'yes', 'y', '1', 'x'].includes(value.trim().toLowerCase());
}

/**
 * Rows (header first) to validated drafts.
 *
 * Every row is validated and returned, valid or not — an import that stopped at
 * the first bad row would make someone fix a hundred-row file one row at a
 * time. The page shows the failures alongside the successes and imports
 * nothing until they are gone.
 */
export function rowsToDrafts(rows: readonly (readonly string[])[], existingKeys: readonly string[]): ImportResult {
  const [header, ...body] = rows;
  if (!header) return { rows: [], fatal: 'The file is empty.' };

  const index = headerIndex(header);
  const missing = IMPORT_COLUMNS.filter((column) => !index.has(column.toLowerCase())).filter(
    // The optional columns: absent means "none privileged" and "no tags", both
    // of which are reasonable files rather than broken ones.
    (column) => column !== 'isPrivileged' && column !== 'tags',
  );
  if (missing.length > 0) {
    return { rows: [], fatal: `Missing column(s): ${missing.join(', ')}. Expected: ${IMPORT_COLUMNS.join(', ')}.` };
  }

  const cell = (row: readonly string[], column: string) => {
    const position = index.get(column.toLowerCase());
    return position === undefined ? '' : String(row[position] ?? '').trim();
  };

  const parsed: { line: number; draft: FeatureDraft }[] = [];

  body.forEach((row, position) => {
    // Blank lines are what a spreadsheet leaves behind; they are not errors.
    if (row.every((value) => String(value ?? '').trim() === '')) return;

    parsed.push({
      // +2: one for the header, one because a person counts from 1.
      line: position + 2,
      draft: {
        key: cell(row, 'key'),
        module: cell(row, 'module'),
        level: cell(row, 'level').toLowerCase(),
        label: cell(row, 'label'),
        description: cell(row, 'description'),
        isPrivileged: toBoolean(cell(row, 'isPrivileged')),
        tags: cell(row, 'tags'),
      },
    });
  });

  if (parsed.length === 0) return { rows: [], fatal: 'The file has a header but no rows.' };

  /*
   * Validated as a LIST, which is what catches a key the file uses twice — both
   * rows pass individually and then `composeFeatures` throws at boot. The same
   * function validates the editable grid this feeds, so a file and a hand-typed
   * row cannot be judged by different rules.
   */
  const errors = validateDraftList(
    parsed.map((entry) => entry.draft),
    existingKeys,
  );

  return { rows: parsed.map((entry, index) => ({ ...entry, errors: errors[index] ?? {} })) };
}

/**
 * A minimal CSV reader — quoted fields, escaped quotes, embedded newlines.
 *
 * Hand-written rather than a dependency because the format this accepts is one
 * it also documents, and a parser is thirty lines. The xlsx path DOES take a
 * dependency, dynamically imported, because that format is a zip archive of XML
 * and nobody should hand-roll it.
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  // Normalised first so a CRLF file does not leave \r on the end of every last
  // field — invisible in a diff and fatal to a key comparison.
  const source = text.replace(/\r\n?/g, '\n');

  for (let position = 0; position < source.length; position++) {
    const char = source[position];
    // `noUncheckedIndexedAccess` is on workspace-wide, and it is right to be:
    // the bound above makes this unreachable, but asserting that with a cast
    // would be the one place the guarantee is assumed rather than checked.
    if (char === undefined) break;

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (source[position + 1] === '"') {
          field += '"';
          position++;
        } else quoted = false;
      } else field += char;
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }

  // The last field only ends at EOF when the file has no trailing newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A file someone can fill in, so the first import is not a guessing game. */
export function importTemplateCsv(): string {
  return [
    IMPORT_COLUMNS.join(','),
    'reports:read,reports,organization,View reports,"Read the reporting section.",false,admin',
    'reports:export,reports,organization,Export reports,"Download report data as a file.",true,"admin, billing"',
  ].join('\n');
}
