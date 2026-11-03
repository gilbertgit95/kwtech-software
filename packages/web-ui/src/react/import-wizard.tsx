'use client';

import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { type DragEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { SheetDialog, sheetButtonClass } from './sheet-dialog.js';
import { cn } from './utils.js';
import { readWorkbook } from './workbook.js';
import {
  type ImportWizardMode,
  type ImportWizardOutcome,
  type ImportWizardPreview,
  type ImportWizardSheet,
  importBlocker,
  importButtonLabel,
  importSummary,
  problemPlace,
  type WorkbookReading,
} from './workbook-rules.js';

/**
 * Importing a module's setup from Excel, step by step (issue #35):
 *
 *   Upload → Mode → Preview, then Import → Result
 *
 * ⚠ IT KNOWS NOTHING ABOUT WHAT IS IMPORTED. The module says what a file would
 * do (`preview`) and does it (`apply`), with `module-kit`'s `readSheet` and
 * `planSheetImport`; the wizard reads the file, shows the plan, and holds the
 * person's choices. `apply` is handed the file again rather than the preview,
 * so the module plans afresh — the store may have changed while the person
 * read — and its mutation checks every row once more on the server.
 *
 * ⚠ NOTHING CHANGES BEFORE THE LAST STEP: reading and previewing only read.
 */
export interface ImportWizardProps {
  open: boolean;
  /** The dialog's title. */
  title?: string;
  /** The first step's words: what the file holds, and what importing does. */
  description: ReactNode;
  /** What this file would do in this mode. Called after the upload, and again when the mode changes. */
  preview: (reading: WorkbookReading, mode: ImportWizardMode) => Promise<ImportWizardPreview>;
  /** Imports it: all or nothing, or without the rows with errors when the person chose that. */
  apply: (reading: WorkbookReading, mode: ImportWizardMode, skipErrorRows: boolean) => Promise<ImportWizardOutcome>;
  /** Offers "Download template" on the first step. */
  onTemplate?: (() => Promise<void>) | undefined;
  /** The last step's way on: "Go to Items". */
  done?: { label: string; onSelect: () => void } | undefined;
  onClose: () => void;
}

type Step = 'upload' | 'mode' | 'preview' | 'result';

/** How many problems and archived names each sheet lists before "and N more". */
const LISTED = 50;

export function ImportWizard({
  open,
  title = 'Import from Excel',
  description,
  preview,
  apply,
  onTemplate,
  done,
  onClose,
}: ImportWizardProps) {
  const [step, setStep] = useState<Step>('upload');
  const [reading, setReading] = useState<WorkbookReading | null>(null);
  const [mode, setMode] = useState<ImportWizardMode>('merge');
  const [plan, setPlan] = useState<ImportWizardPreview | null>(null);
  const [skipErrorRows, setSkipErrorRows] = useState(false);
  const [outcome, setOutcome] = useState<ImportWizardOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every opening starts clean: a file from last time is never imported by accident.
  useEffect(() => {
    if (!open) return;
    setStep('upload');
    setReading(null);
    setMode('merge');
    setPlan(null);
    setSkipErrorRows(false);
    setOutcome(null);
    setError(null);
  }, [open]);

  async function run(work: () => Promise<void>, fallback: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  const choose = (file: File) =>
    run(async () => {
      setReading(await readWorkbook(file));
      setStep('mode');
    }, 'Could not read this file.');

  const toPreview = () =>
    run(async () => {
      if (!reading) return;
      setPlan(await preview(reading, mode));
      setSkipErrorRows(false);
      setStep('preview');
    }, 'Could not check this file.');

  const toImport = () =>
    run(async () => {
      if (!reading) return;
      setOutcome(await apply(reading, mode, skipErrorRows));
      setStep('result');
    }, 'Could not import this file. Nothing was changed.');

  const blocker = plan ? importBlocker(plan, skipErrorRows) : null;
  const totalErrors = plan ? plan.sheets.reduce((sum, sheet) => sum + sheet.counts.errors, 0) : 0;

  const footer = (() => {
    switch (step) {
      case 'upload':
        return (
          <button type="button" className={sheetButtonClass('secondary')} onClick={onClose}>
            Cancel
          </button>
        );
      case 'mode':
        return (
          <>
            <button
              type="button"
              className={sheetButtonClass('secondary')}
              disabled={busy}
              onClick={() => setStep('upload')}
            >
              Back
            </button>
            <button type="button" className={sheetButtonClass('primary')} disabled={busy} onClick={toPreview}>
              {busy ? 'Checking…' : 'Check the file'}
            </button>
          </>
        );
      case 'preview':
        return (
          <>
            <button
              type="button"
              className={sheetButtonClass('secondary')}
              disabled={busy}
              onClick={() => setStep('mode')}
            >
              Back
            </button>
            <button
              type="button"
              className={sheetButtonClass('primary')}
              disabled={busy || blocker !== null}
              onClick={toImport}
            >
              {busy ? 'Importing…' : plan ? importButtonLabel(plan) : 'Import'}
            </button>
          </>
        );
      case 'result':
        return (
          <>
            <button type="button" className={sheetButtonClass(done ? 'secondary' : 'primary')} onClick={onClose}>
              Close
            </button>
            {done ? (
              <button type="button" className={sheetButtonClass('primary')} onClick={done.onSelect}>
                {done.label}
              </button>
            ) : null}
          </>
        );
    }
  })();

  return (
    <SheetDialog open={open} title={title} busy={busy} onClose={onClose} footer={footer}>
      <ol aria-label="Steps" className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {(['upload', 'mode', 'preview', 'result'] as const).map((one, index) => (
          <li
            key={one}
            aria-current={one === step ? 'step' : undefined}
            className={cn(one === step && 'font-semibold text-foreground')}
          >
            {index + 1}. {STEP_LABELS[one]}
          </li>
        ))}
      </ol>

      {error ? (
        <p role="alert" className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {step === 'upload' ? (
        <UploadStep description={description} busy={busy} onChoose={choose} onTemplate={onTemplate} />
      ) : null}
      {step === 'mode' && reading ? <ModeStep fileName={reading.fileName} mode={mode} onMode={setMode} /> : null}
      {step === 'preview' && plan ? (
        <PreviewStep
          plan={plan}
          mode={mode}
          totalErrors={totalErrors}
          skipErrorRows={skipErrorRows}
          onSkipErrorRows={setSkipErrorRows}
          blocker={blocker}
        />
      ) : null}
      {step === 'result' && outcome ? <ResultStep outcome={outcome} /> : null}
    </SheetDialog>
  );
}

const STEP_LABELS: Record<Step, string> = { upload: 'Choose a file', mode: 'How', preview: 'Check', result: 'Done' };

function UploadStep({
  description,
  busy,
  onChoose,
  onTemplate,
}: {
  description: ReactNode;
  busy: boolean;
  onChoose: (file: File) => void;
  onTemplate: (() => Promise<void>) | undefined;
}) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file && !busy) onChoose(file);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-muted-foreground">{description}</div>
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-8 text-center',
          'hover:bg-accent focus-within:ring-2 focus-within:ring-ring',
          over && 'border-primary bg-accent',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        <Upload aria-hidden="true" className="size-6 text-muted-foreground" />
        <span className="text-sm font-medium">
          {busy ? 'Reading the file…' : 'Drop an Excel file here, or choose one'}
        </span>
        <span className="text-xs text-muted-foreground">.xlsx, up to 5 MB</span>
        <input
          id={inputId}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared, so choosing the same file again (after fixing it) fires again.
            event.target.value = '';
            if (file) onChoose(file);
          }}
        />
      </label>
      {onTemplate ? (
        <p className="text-sm text-muted-foreground">
          Starting from nothing?{' '}
          <button
            type="button"
            disabled={templateBusy}
            className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline disabled:opacity-60"
            onClick={async () => {
              setTemplateBusy(true);
              try {
                await onTemplate();
              } finally {
                setTemplateBusy(false);
              }
            }}
          >
            <FileSpreadsheet aria-hidden="true" className="size-4" />
            {templateBusy ? 'Preparing…' : 'Download the template'}
          </button>{' '}
          — every sheet, with an example row and a Read me.
        </p>
      ) : null}
    </div>
  );
}

function ModeStep({
  fileName,
  mode,
  onMode,
}: {
  fileName: string;
  mode: ImportWizardMode;
  onMode: (mode: ImportWizardMode) => void;
}) {
  const name = useId();
  const options: { value: ImportWizardMode; label: string; detail: string }[] = [
    {
      value: 'merge',
      label: 'Add and update',
      detail: 'Adds what is new in the file and updates what changed. Nothing else is touched.',
    },
    {
      value: 'replace',
      label: 'Replace',
      detail:
        'Also archives anything the file leaves out, on the sheets the file has. Nothing is deleted, and you see the list before anything changes.',
    },
  ];
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm">
        <span className="font-medium">{fileName}</span> is read. How should it be imported?
      </legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'flex cursor-pointer gap-3 rounded-lg border border-border p-3 hover:bg-accent focus-within:ring-2 focus-within:ring-ring',
            mode === option.value && 'border-primary bg-accent',
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={mode === option.value}
            onChange={() => onMode(option.value)}
            className="mt-1"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{option.label}</span>
            <span className="text-sm text-muted-foreground">{option.detail}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function PreviewStep({
  plan,
  mode,
  totalErrors,
  skipErrorRows,
  onSkipErrorRows,
  blocker,
}: {
  plan: ImportWizardPreview;
  mode: ImportWizardMode;
  totalErrors: number;
  skipErrorRows: boolean;
  onSkipErrorRows: (skip: boolean) => void;
  blocker: string | null;
}) {
  const skipId = useId();
  return (
    <div className="flex flex-col gap-4">
      {plan.fatal.length > 0 ? (
        <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="font-medium">This file cannot be imported yet:</p>
          <ul className="mt-1 list-disc pl-5">
            {plan.fatal.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="flex flex-col gap-3">
        {plan.sheets.map((sheet) => (
          <SheetPreview key={sheet.name} sheet={sheet} mode={mode} />
        ))}
      </ul>

      {totalErrors > 0 && plan.fatal.length === 0 ? (
        <label htmlFor={skipId} className="flex items-start gap-2 text-sm">
          <input
            id={skipId}
            type="checkbox"
            checked={skipErrorRows}
            onChange={(event) => onSkipErrorRows(event.target.checked)}
            className="mt-0.5"
          />
          <span>
            Skip the {totalErrors === 1 ? 'row' : `${totalErrors} rows`} with errors and import the rest. They can be
            fixed and imported later.
          </span>
        </label>
      ) : null}

      {blocker ? (
        <p role="status" className="text-sm text-muted-foreground">
          {blocker}
        </p>
      ) : null}
    </div>
  );
}

function SheetPreview({ sheet, mode }: { sheet: ImportWizardSheet; mode: ImportWizardMode }) {
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{sheet.name}</h3>
        <span className="text-xs text-muted-foreground">
          {sheet.missing ? 'Not in the file — left as it is' : importSummary(sheet.counts)}
        </span>
      </div>

      {sheet.problems.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-sm" aria-label={`Errors in ${sheet.name}`}>
          {sheet.problems.slice(0, LISTED).map((problem) => (
            <li key={`${problem.line}:${problem.column}:${problem.message}`} className="flex gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>
                <span className="font-medium">{problemPlace(problem)}:</span> {problem.message}
              </span>
            </li>
          ))}
          {sheet.problems.length > LISTED ? (
            <li className="text-muted-foreground">and {sheet.problems.length - LISTED} more.</li>
          ) : null}
        </ul>
      ) : null}

      {mode === 'replace' && sheet.archived.length > 0 ? (
        <div className="mt-2 text-sm">
          <p className="font-medium">Will be archived (not deleted):</p>
          <p className="text-muted-foreground">
            {sheet.archived.slice(0, LISTED).join(', ')}
            {sheet.archived.length > LISTED ? `, and ${sheet.archived.length - LISTED} more` : ''}.
          </p>
        </div>
      ) : null}
    </li>
  );
}

function ResultStep({ outcome }: { outcome: ImportWizardOutcome }) {
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 aria-hidden="true" className="size-5 text-status-success" />
        Imported.
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {outcome.sheets.map((sheet) => (
          <li key={sheet.name}>
            <span className="font-medium">{sheet.name}:</span>{' '}
            {[
              sheet.created ? `${sheet.created} added` : null,
              sheet.updated ? `${sheet.updated} updated` : null,
              sheet.archived ? `${sheet.archived} archived` : null,
            ]
              .filter(Boolean)
              .join(', ') || 'no changes'}
          </li>
        ))}
      </ul>
    </div>
  );
}
