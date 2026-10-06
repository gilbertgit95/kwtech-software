'use client';

import { ConfirmDialog, cn } from '@kwtech/web-ui/react';
import { Download, Printer, RotateCcw } from 'lucide-react';
import { type RefObject, useEffect, useId, useState } from 'react';
import type { StudioLogEntry } from '../../domain/log.js';
import { downloadResult, printResult, type StudioResult } from '../render/result.js';
import type { StudioAppState } from '../studio-state.js';
import { buttonClass, INPUT_CLASS } from './controls.js';

/** What the output bar's buttons do, for a shortcut key to call. Null while there is nothing to make. */
export interface StudioOutputCommands {
  download(): void;
  print(): void;
}

/**
 * The way out: Download, Print, and Start over.
 *
 * ## One press, not two (the operator, 2026-10-05)
 *
 * The first version had a "Make the result" button and then a second bar with
 * Download and Print. That was a step nobody needed to see. Now Download and
 * Print each make the result themselves when there is none — and reuse it when
 * nothing has changed since.
 *
 * ## Print and go (PRINT-STUDIO-PLAN decision 8)
 *
 * The result is a file in this tab's memory and nowhere else.
 *
 *   Download    — the main action. The saved PDF printed at 100% is the size
 *                 the layout says; the browser's own print dialog may rescale.
 *   Print       — the browser's dialog, for when that is good enough.
 *   Start over  — clears the photos and the result. ⚠ Asks once whether to
 *                 download first when that has not happened: it is the last
 *                 moment the file exists.
 *
 * Each Download and Print is recorded in the print history — who, when, what
 * paper, and the file NAMES. A failed record never blocks the print.
 */
export function OutputBar({
  state,
  summary,
  copies,
  onCopies,
  calibrations,
  calibrationId,
  onCalibration,
  canMake,
  result,
  make,
  fileName,
  entry,
  hasWork,
  onStartOver,
  onError,
  commands,
}: {
  state: StudioAppState;
  /** What will come out: "2 pages, 28 photos". */
  summary: string;
  copies: number;
  onCopies: (copies: number) => void;
  /** Omitted for a document, which is copied as it is and takes no calibration. */
  calibrations?: readonly { id: string; name: string }[];
  calibrationId?: string;
  onCalibration?: (id: string) => void;
  /** Whether there is anything to make a result from. */
  canMake: boolean;
  /** The result of the arrangement as it is now, or null when it has changed since one was made. */
  result: StudioResult | null;
  /** Make the result. Called only when `result` is null. */
  make: () => Promise<StudioResult>;
  fileName: string;
  /** What to record for a result, without the action — this bar knows which button was pressed. */
  entry: (result: StudioResult) => Omit<StudioLogEntry, 'action'>;
  /** Whether there is anything to lose by starting over. */
  hasWork: boolean;
  onStartOver: () => void;
  onError: (message: string | null) => void;
  /** Filled in by this bar with what its buttons do, so a shortcut key can press them. */
  commands?: RefObject<StudioOutputCommands | null>;
}) {
  const calibrationInput = useId();
  const copiesInput = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  // A new arrangement is a new result: the last download was of something else.
  useEffect(() => {
    if (result === null) setDownloaded(false);
  }, [result]);

  // ⚠ The last guard: closing or reloading the page loses work that was never saved.
  const atRisk = hasWork && !downloaded;
  useEffect(() => {
    if (!atRisk) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [atRisk]);

  async function run(action: StudioLogEntry['action']) {
    onError(null);
    setSaid(null);
    setBusy(action === 'downloaded' ? 'Making the PDF…' : 'Getting ready to print…');
    try {
      const ready = result ?? (await make());
      if (action === 'downloaded') {
        downloadResult(ready, fileName);
        setDownloaded(true);
        setSaid('Saved to your downloads. Print it at 100% (“actual size”), not “fit to page”.');
      } else {
        printResult(ready);
        setSaid('In the print window, choose 100% (“actual size”), not “fit to page”.');
      }
      // Fire and forget: the print does not wait on the history.
      state.client.recordPrint(state.scope, { ...entry(ready), action }).catch(() => undefined);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Could not make the result.');
    } finally {
      setBusy(null);
    }
  }

  const disabled = !canMake || busy !== null;
  // Each render: the commands close over this render's result and settings, as the buttons do.
  if (commands) {
    commands.current = disabled
      ? null
      : { download: () => void run('downloaded'), print: () => void run('sent_to_print') };
  }
  return (
    /*
     * A card as narrow as the settings column it sits under (`StudioSplit`), so
     * it is laid out in rows that also read at full width on a narrow panel:
     * what will come out, the two numbers that change it, then the buttons.
     */
    <section
      aria-label="Print and download"
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3 shadow-sm"
    >
      <div className="flex min-h-8 items-center justify-between gap-2">
        <p className="min-w-0 text-sm font-medium">{summary}</p>
        {hasWork ? (
          <button
            type="button"
            className={cn(buttonClass('ghost', 'sm'), '-mr-1 text-muted-foreground')}
            disabled={busy !== null}
            onClick={() => (atRisk ? setAsking(true) : onStartOver())}
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            Start over
          </button>
        ) : null}
      </div>
      <div className="flex items-end gap-2">
        <div className="flex w-20 shrink-0 flex-col gap-1">
          <label htmlFor={copiesInput} className="text-xs font-medium text-muted-foreground">
            Copies
          </label>
          <input
            id={copiesInput}
            type="number"
            min={1}
            max={99}
            className={cn(INPUT_CLASS, 'h-9')}
            value={copies}
            onChange={(event) => onCopies(Math.min(Math.max(Math.trunc(Number(event.target.value) || 1), 1), 99))}
          />
        </div>
        {calibrations && calibrations.length > 0 && onCalibration ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={calibrationInput} className="text-xs font-medium text-muted-foreground">
              Printer calibration
            </label>
            <select
              id={calibrationInput}
              className={cn(INPUT_CLASS, 'h-9')}
              value={calibrationId ?? ''}
              onChange={(event) => onCalibration(event.target.value)}
            >
              <option value="">None</option>
              {calibrations.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass('secondary')}
          disabled={disabled}
          onClick={() => void run('sent_to_print')}
        >
          <Printer aria-hidden="true" className="size-4" />
          Print
        </button>
        <button
          type="button"
          className={cn(buttonClass('primary'), 'min-w-0 flex-1')}
          disabled={disabled}
          onClick={() => void run('downloaded')}
        >
          <Download aria-hidden="true" className="size-4" />
          {busy ?? 'Download PDF'}
        </button>
      </div>
      {said ? (
        <p role="status" className="text-xs text-muted-foreground">
          {said}
        </p>
      ) : null}

      <ConfirmDialog
        open={asking}
        title="Start over without downloading?"
        description="The photos and the result will be cleared from this page. They are not saved anywhere, so this is the last chance to keep the file."
        confirmLabel="Clear everything"
        alternative={
          canMake
            ? {
                label: 'Download first',
                onSelect: () => {
                  setAsking(false);
                  void run('downloaded');
                },
              }
            : undefined
        }
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          onStartOver();
        }}
      />
    </section>
  );
}
