'use client';

import { ConfirmDialog, DataGrid, type DataGridColumn } from '@kwtech/web-ui/react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { EMPTY_DRAFT, type FeatureDraft, hasErrors, validateDraftList } from '../../domain/feature-draft.js';
import { IMPORT_COLUMNS, importTemplateCsv, parseDelimited, rowsToDrafts } from '../../domain/spreadsheet.js';
import { FEATURE, FEATURE_REGISTRY } from '../../feature-keys.js';
import { ROLE_LEVELS } from '../../types.js';
import { AdminPage } from './admin-page.js';
import { RegistryOutput } from './registry-output.js';

/**
 * `/admin/features/new/import` — bring features in from a spreadsheet, then fix
 * them in place before committing to anything.
 *
 * ## A staging grid, not an importer
 *
 * The file is parsed into an EDITABLE grid and nothing else happens. A row with
 * a typo is corrected here rather than in the spreadsheet and re-uploaded; rows
 * can be added by hand alongside imported ones; nothing leaves this page until
 * Save is pressed. That is the difference between an import that rejects a
 * hundred-row file and one that lets you fix the three rows that were wrong.
 *
 * Validation is live — `validateDraftList` runs on every edit — so the errors
 * under the grid track what is actually in it, and Save is not a moment of
 * discovery.
 *
 * ## What Save does
 *
 * Validates everything and emits the registry source. It does NOT write rows:
 * `syncFeatureRegistry` deprecates any `perm_feature` row absent from
 * `FEATURE_REGISTRY`, so a feature saved to the table would be switched off by
 * the next deploy and could never be granted. See RegistryOutput.
 */

/** A grid row: a draft, plus what the grid needs to track and explain it. */
interface DraftRow extends FeatureDraft {
  /** Stable across edits and re-sorts — the grid's `getRowId`. */
  id: string;
  /** Source line for an imported row; null for one typed in here. */
  line: number | null;
  /** Recomputed on every render, so the grid can colour the offending cells. */
  errors: Record<string, string | undefined>;
}

let nextId = 0;
const newId = () => `row-${nextId++}`;

/** A staged row before it is given its derived errors. */
interface StagedEntry {
  id: string;
  line: number | null;
  draft: FeatureDraft;
}

export function FeatureImportPage() {
  const [drafts, setDrafts] = useState<StagedEntry[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<FeatureDraft[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /**
   * A parsed file waiting for the reader to say what to do with it.
   *
   * Parsed BEFORE the question is asked, on purpose: it lets the dialog say
   * "12 rows" instead of "the file", and a file that could not be read reports
   * its error rather than prompting for a choice about nothing.
   */
  const [pending, setPending] = useState<{ fileName: string; entries: StagedEntry[] } | null>(null);
  const [selected, setSelected] = useState<DraftRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const existingKeys = useMemo(() => FEATURE_REGISTRY.map((spec) => spec.key), []);

  /*
   * Errors are DERIVED, never stored. Keeping them in state alongside the rows
   * would mean two things to update on every edit, and the day one is missed
   * the grid shows an error for a value that has already been fixed.
   */
  const rows = useMemo<DraftRow[]>(() => {
    const errors = validateDraftList(
      drafts.map((entry) => entry.draft),
      existingKeys,
    );
    return drafts.map((entry, index) => ({
      ...entry.draft,
      id: entry.id,
      line: entry.line,
      errors: (errors[index] ?? {}) as Record<string, string | undefined>,
    }));
  }, [drafts, existingKeys]);

  const invalid = rows.filter((row) => hasErrors(row.errors));
  /* Worth saying in the dialog: hand-typed rows are the ones nobody can re-import. */
  const hasTyped = drafts.some((entry) => entry.line === null);

  async function readFile(file: File) {
    setBusy(true);
    setFileName(file.name);
    setSaved(null);
    try {
      const parsed = file.name.toLowerCase().endsWith('.xlsx')
        ? await readXlsx(file)
        : parseDelimited(await file.text(), file.name.toLowerCase().endsWith('.tsv') ? '\t' : ',');
      const result = rowsToDrafts(parsed, existingKeys);
      setFatal(result.fatal ?? null);
      if (result.fatal) return;

      const entries = result.rows.map((row) => ({ id: newId(), line: row.line, draft: row.draft }));

      /*
       * ASK ONLY WHEN THERE IS SOMETHING TO LOSE.
       *
       * With an empty grid there is no choice to make — "replace nothing" and
       * "add to nothing" are the same outcome — and a dialog on the very first
       * import would be a question with one answer. Prompting on every import
       * regardless is how people learn to dismiss dialogs without reading them,
       * which is exactly what makes the one that mattered get dismissed too.
       *
       * `drafts` is read from the render scope rather than inside a `setDrafts`
       * updater. Calling one setState from inside another's updater runs it
       * twice under StrictMode, and an updater is meant to be pure; the value
       * cannot go stale here anyway, because the only thing that happened since
       * this render is the reader picking a file.
       */
      if (drafts.length === 0) setDrafts(entries);
      else setPending({ fileName: file.name, entries });
    } catch (error) {
      // Unreadable file, or `read-excel-file` absent. Both are the same to a
      // reader: this file did not open.
      setFatal(error instanceof Error ? error.message : 'Could not read the file.');
    } finally {
      setBusy(false);
      // Cleared so re-picking the SAME file fires `change` again — the input
      // holds its value otherwise and a second attempt does nothing.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const onCellEdit = useCallback((row: DraftRow) => {
    setSaved(null);
    setDrafts((current) =>
      current.map((entry) =>
        entry.id === row.id
          ? {
              ...entry,
              draft: {
                key: row.key,
                module: row.module,
                level: row.level,
                label: row.label,
                description: row.description,
                isPrivileged: row.isPrivileged,
                tags: row.tags,
              },
            }
          : entry,
      ),
    );
  }, []);

  const addRow = useCallback(() => {
    setSaved(null);
    setDrafts((current) => [...current, { id: newId(), line: null, draft: { ...EMPTY_DRAFT } }]);
  }, []);

  const removeSelected = useCallback(() => {
    const ids = new Set(selected.map((row) => row.id));
    setSaved(null);
    setDrafts((current) => current.filter((entry) => !ids.has(entry.id)));
    setSelected([]);
  }, [selected]);

  function save() {
    // Recomputed from `rows` rather than trusting a flag: the grid may have
    // committed an edit in the same tick the button was pressed.
    if (invalid.length > 0) {
      setSaved(null);
      return;
    }
    setSaved(rows.map(({ id: _id, line: _line, errors: _errors, ...draft }) => draft));
  }

  return (
    <AdminPage
      title="Import features"
      description="Bring rows in from a spreadsheet, correct them here, and add any that were missing. Nothing is written until you save."
      feature={FEATURE.featuresImport}
      backTo={{ href: '/admin/features', label: 'Features' }}
      layout="fill"
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium text-card-foreground">Open a file</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <code className="font-mono">.csv</code>, <code className="font-mono">.tsv</code> or{' '}
                <code className="font-mono">.xlsx</code> with a header row. Columns:{' '}
                <code className="font-mono">{IMPORT_COLUMNS.join(', ')}</code> — any order,{' '}
                <code className="font-mono">isPrivileged</code> optional.
              </p>
            </div>
            <TemplateLink className="ml-auto" />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,.xlsx"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }}
              className="block w-full max-w-sm text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-accent"
            />
            {busy ? <span className="text-sm text-muted-foreground">Reading {fileName}…</span> : null}
          </div>

          {fatal ? (
            <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {fatal}
            </p>
          ) : null}
        </section>

        <DataGrid<DraftRow>
          rows={rows}
          columns={COLUMNS}
          searchPlaceholder={rows.length > 0 ? 'Search staged rows…' : undefined}
          height="fill"
          getRowId={getRowId}
          onCellEdit={onCellEdit}
          onSelectionChange={setSelected}
          toolbar={
            <>
              <button
                type="button"
                onClick={addRow}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                Add row
              </button>
              <button
                type="button"
                onClick={removeSelected}
                disabled={selected.length === 0}
                className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50 disabled:hover:bg-transparent"
              >
                Remove{selected.length > 0 ? ` (${selected.length})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={rows.length === 0}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent"
              >
                Clear all
              </button>
            </>
          }
        />

        {/*
          The status line and Save, pinned under the grid rather than scrolling
          with it: the count of problems is the thing someone checks before
          pressing the button, so it belongs next to the button.
        */}
        <section className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? (
              'Nothing staged yet — open a file, or add a row.'
            ) : invalid.length === 0 ? (
              <span className="text-status-success-foreground">
                {rows.length} row{rows.length === 1 ? '' : 's'}, all valid.
              </span>
            ) : (
              <span className="text-status-error-foreground">
                {invalid.length} of {rows.length} row{rows.length === 1 ? '' : 's'} need fixing — the offending cells
                are outlined.
              </span>
            )}
          </p>

          <button
            type="button"
            onClick={save}
            // Disabled on an EMPTY grid only. With invalid rows it stays live
            // and refuses on press, because a disabled button explains nothing
            // — and the count beside it already says what is wrong.
            disabled={rows.length === 0}
            className="ml-auto rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            Save with validation
          </button>
        </section>

        {saved ? <RegistryOutput drafts={saved} heading={`Add these ${saved.length} to the registry`} /> : null}
      </div>

      {/*
        Two real answers, not a yes/no. "Replace" and "Add" are outcomes for the
        rows ALREADY STAGED, which is the actual decision — the incoming file
        arrives either way.

        The words are chosen for accuracy: "Replace", not "Overwrite", because
        nothing has been written anywhere yet — the staged rows are discarded,
        not overwritten in storage. And each label names what happens to the
        staged rows rather than to the file, since that is the half at risk.
      */}
      <ConfirmDialog
        open={pending !== null}
        title={`Add ${pending?.entries.length ?? 0} row${pending?.entries.length === 1 ? '' : 's'} from ${pending?.fileName ?? ''}?`}
        description={
          <>
            <p>
              You already have{' '}
              <span className="font-medium text-card-foreground">
                {drafts.length} staged row{drafts.length === 1 ? '' : 's'}
              </span>
              {hasTyped ? ', including some typed in here' : ''}. Nothing has been saved yet either way.
            </p>
            <ul className="mt-2 list-disc pl-5">
              <li>
                <span className="font-medium text-card-foreground">Replace</span> — discard what is staged and keep only
                this file.
              </li>
              <li>
                <span className="font-medium text-card-foreground">Add</span> — keep both, with this file's rows on the
                end.
              </li>
            </ul>
          </>
        }
        confirmLabel="Replace staged rows"
        alternative={{
          label: 'Add to staged rows',
          onSelect: () => {
            if (pending) setDrafts((current) => [...current, ...pending.entries]);
            setPending(null);
            setSaved(null);
          },
        }}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) setDrafts(pending.entries);
          setPending(null);
          setSaved(null);
          setSelected([]);
        }}
      />

      <ConfirmDialog
        open={confirmClear}
        title="Clear all staged rows?"
        description={`${rows.length} staged row${rows.length === 1 ? '' : 's'} will be discarded, including anything typed in here. Nothing has been saved yet, so there is nothing to undo.`}
        confirmLabel="Clear all"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setDrafts([]);
          setSelected([]);
          setSaved(null);
          setFileName(null);
          setConfirmClear(false);
        }}
      />
    </AdminPage>
  );
}

const getRowId = (row: DraftRow) => row.id;

/**
 * Outlines a cell whose own field is in error.
 *
 * Per FIELD rather than per row: a row with a bad key and a good label should
 * point at the key. Marking the whole row red says "something here is wrong" and
 * leaves the reader to find it.
 */
/** The one class that marks a cell whose own field is wrong. */
const INVALID_CELL = 'outline outline-1 -outline-offset-1 outline-destructive';

/**
 * Per FIELD, not per row: a row with a bad key and a good label should point at
 * the key. Marking the whole row red says "something here is wrong" and leaves
 * the reader to find it.
 */
const errorFor = (row: DraftRow | undefined, field: keyof FeatureDraft) => row?.errors[field];

/*
 * The callbacks are written INLINE rather than built by a helper, so TypeScript
 * types their parameters from the annotation on this array. A helper returning
 * a bare arrow has to describe AG Grid's params itself, which is a second,
 * hand-written copy of a type that already exists.
 */
const COLUMNS: readonly DataGridColumn<DraftRow>[] = [
  {
    field: 'key',
    headerName: 'Key',
    editable: true,
    minWidth: 190,
    cellClass: (params) => (errorFor(params.data, 'key') ? INVALID_CELL : ''),
    tooltipValueGetter: (params) => errorFor(params.data, 'key') ?? '',
  },
  {
    field: 'module',
    headerName: 'Module',
    editable: true,
    minWidth: 130,
    cellClass: (params) => (errorFor(params.data, 'module') ? INVALID_CELL : ''),
    tooltipValueGetter: (params) => errorFor(params.data, 'module') ?? '',
  },
  {
    field: 'level',
    headerName: 'Level',
    editable: true,
    minWidth: 140,
    /*
     * A picker, not a text box. Level is a closed set of three, and typing it
     * by hand is the single most likely way an imported row is wrong — which is
     * also why the import lower-cases it.
     */
    cellEditor: 'agSelectCellEditor',
    cellEditorParams: { values: [...ROLE_LEVELS] },
    cellClass: (params) => (errorFor(params.data, 'level') ? INVALID_CELL : ''),
    tooltipValueGetter: (params) => errorFor(params.data, 'level') ?? '',
  },
  {
    field: 'label',
    headerName: 'Label',
    editable: true,
    flex: 1,
    minWidth: 160,
    cellClass: (params) => (errorFor(params.data, 'label') ? INVALID_CELL : ''),
    tooltipValueGetter: (params) => errorFor(params.data, 'label') ?? '',
  },
  {
    field: 'description',
    headerName: 'Description',
    editable: true,
    flex: 2,
    minWidth: 220,
    // A sentence, so it gets a box rather than a one-line input.
    cellEditor: 'agLargeTextCellEditor',
    cellEditorPopup: true,
    cellClass: (params) => (errorFor(params.data, 'description') ? INVALID_CELL : ''),
    tooltipValueGetter: (params) => errorFor(params.data, 'description') ?? '',
  },
  {
    field: 'tags',
    headerName: 'Tags',
    editable: true,
    minWidth: 160,
    // Comma-separated, matching the spreadsheet column and the manual form —
    // one spelling of "a list of tags" across all three entry points.
    cellClass: (params) => (errorFor(params.data, 'tags') ? INVALID_CELL : ''),
    tooltipValueGetter: (params) => errorFor(params.data, 'tags') ?? '',
  },
  {
    field: 'isPrivileged',
    headerName: 'Privileged',
    editable: true,
    minWidth: 120,
    maxWidth: 140,
    flex: 0,
    cellEditor: 'agCheckboxCellEditor',
    cellRenderer: 'agCheckboxCellRenderer',
  },
  {
    field: 'line',
    headerName: 'Source',
    editable: false,
    minWidth: 100,
    maxWidth: 120,
    flex: 0,
    // 'Added' for a row typed here — it has no line in any file, and a blank
    // would read as missing data rather than as a different origin.
    valueFormatter: ({ value }) => (value == null ? 'Added' : `Line ${value}`),
  },
];

/**
 * A starter file, generated in the browser rather than served as an asset — it
 * is derived from `IMPORT_COLUMNS`, so it cannot fall out of step with what the
 * parser expects.
 */
function TemplateLink({ className }: { className?: string | undefined }) {
  function download() {
    const blob = new Blob([importTemplateCsv()], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'features-template.csv';
    anchor.click();
    // Released immediately: the click has already started the download, and a
    // blob URL left behind pins the data for the life of the document.
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className={`rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent ${className ?? ''}`}
    >
      Download template
    </button>
  );
}

/**
 * `.xlsx`, via a parser loaded only when one is actually opened.
 *
 * `read-excel-file` is an OPTIONAL peer, so an app that never imports
 * spreadsheets does not install it. The message names the package rather than
 * letting a module-resolution error surface as "Cannot find module" in a console
 * the person is not looking at.
 */
async function readXlsx(file: File): Promise<string[][]> {
  /*
   * `/browser`, not the bare package name — it ships no root export, only
   * `./browser`, `./node`, `./universal` and `./web-worker`. This runs in the
   * browser, and picking the right one matters: `/node` reaches for `fs`.
   */
  let readExcelFile: typeof import('read-excel-file/browser').default;
  try {
    readExcelFile = (await import('read-excel-file/browser')).default;
  } catch {
    throw new Error("Reading .xlsx needs the 'read-excel-file' package. Save the sheet as CSV, or install it.");
  }

  const parsed: unknown = await readExcelFile(file);
  const data = (Array.isArray(parsed) ? parsed : (parsed as { data?: unknown[] }).data) as unknown[][] | undefined;
  if (!data) throw new Error('The workbook has no readable sheet.');

  // Every cell to a string: the library returns numbers, dates and booleans by
  // type, and every column here is text — a key read as a number would lose a
  // leading zero and a boolean would stop matching 'true'.
  return data.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))));
}
