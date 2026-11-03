'use client';

import { Download } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { SheetDialog, sheetButtonClass } from './sheet-dialog.js';

/**
 * Exporting a module's setup to Excel (issue #35): which sheets go in — all by
 * default — and whether archived rows go with them, on by default so a copy of
 * a store is complete. The module writes the file (`writeWorkbook`) in
 * `onExport`; this only asks.
 */
export interface ExportDialogProps {
  open: boolean;
  title?: string;
  /** The sheets that may go in, in the file's order. */
  sheets: readonly string[];
  /** Offer "Include archived rows". Omitted: the module has none to offer. */
  archivedOption?: boolean;
  /** Writes and downloads the file. A thrown error is shown, in its own words. */
  onExport: (choice: { sheets: string[]; includeArchived: boolean }) => Promise<void>;
  onClose: () => void;
}

export function ExportDialog({
  open,
  title = 'Export to Excel',
  sheets,
  archivedOption = true,
  onExport,
  onClose,
}: ExportDialogProps) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(sheets));
  const [includeArchived, setIncludeArchived] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archivedId = useId();
  const allId = useId();

  /*
   * Every opening starts from everything, as the issue decided. ⚠ Keyed by the
   * sheet NAMES, not the array: a caller passing a new array each render would
   * otherwise untick and re-tick the boxes while the person uses them.
   */
  const sheetNames = sheets.join('\n');
  useEffect(() => {
    if (!open) return;
    setChosen(new Set(sheetNames.split('\n').filter(Boolean)));
    setIncludeArchived(true);
    setError(null);
  }, [open, sheetNames]);

  const all = sheets.every((sheet) => chosen.has(sheet));
  const toggle = (sheet: string) => {
    const next = new Set(chosen);
    if (next.has(sheet)) next.delete(sheet);
    else next.add(sheet);
    setChosen(next);
  };

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      // In the file's order, whatever order they were ticked in.
      await onExport({ sheets: sheets.filter((sheet) => chosen.has(sheet)), includeArchived });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not make the file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetDialog
      open={open}
      title={title}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={sheetButtonClass('secondary')} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={sheetButtonClass('primary')}
            disabled={busy || chosen.size === 0}
            onClick={download}
          >
            <Download aria-hidden="true" className="size-4" />
            {busy ? 'Preparing…' : 'Download .xlsx'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Sheets</legend>
          <label htmlFor={allId} className="flex items-center gap-2 text-sm">
            <input
              id={allId}
              type="checkbox"
              checked={all}
              onChange={() => setChosen(all ? new Set() : new Set(sheets))}
            />
            All sheets
          </label>
          <div className="flex flex-col gap-1.5 pl-6">
            {sheets.map((sheet) => (
              <label key={sheet} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={chosen.has(sheet)} onChange={() => toggle(sheet)} />
                {sheet}
              </label>
            ))}
          </div>
          {chosen.size === 0 ? <p className="text-sm text-muted-foreground">Choose at least one sheet.</p> : null}
        </fieldset>
        {archivedOption ? (
          <label htmlFor={archivedId} className="flex items-start gap-2 text-sm">
            <input
              id={archivedId}
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              Include archived rows
              <span className="block text-muted-foreground">
                Marked Yes in the Archived column, so the file is a complete copy.
              </span>
            </span>
          </label>
        ) : null}
      </div>
    </SheetDialog>
  );
}
