'use client';

import type { PrinterChoice } from '@kwtech/module-kit';
import { usePrinters } from '@kwtech/module-kit/react';
import { ConfirmDialog, cn, PrinterMenu } from '@kwtech/web-ui/react';
import { Download, Minus, Plus, Printer, RotateCcw } from 'lucide-react';
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
 *   Printers    — one of the workspace's own printers, through the computer
 *                 it is connected to: `usePrinters` from module-kit and
 *                 `PrinterMenu` from web-ui, shared with every module that
 *                 prints. A menu of them, by computer; choosing one opens
 *                 that printer's settings for this print (paper type,
 *                 quality), and Print there sends it. ⚠ The button exists
 *                 only when the app bound the port AND there is a printer to
 *                 offer; otherwise this bar is what it always was.
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

  /*
   * The workspace's printers, when the app bound a way to reach them: read
   * when the bar appears, each time the menu opens and after each print.
   */
  const printing = usePrinters(state.scope);

  // ⚠ The last guard: closing or reloading the page loses work that was never saved.
  const atRisk = hasWork && !downloaded;
  useEffect(() => {
    if (!atRisk) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [atRisk]);

  async function run(action: StudioLogEntry['action'], target?: StudioPrintTarget) {
    onError(null);
    setSaid(null);
    setBusy(action === 'downloaded' ? 'Making the PDF…' : 'Getting ready to print…');
    try {
      const ready = result ?? (await make());
      if (action === 'sent_to_print' && target) {
        setSaid('Reaching the printer…');
        const outcome = await printing.print(
          {
            printerId: target.printer.id,
            pdf: new Uint8Array(await ready.pdf.arrayBuffer()),
            width: ready.sheet.width,
            height: ready.sheet.height,
            settings: target.settings,
          },
          setSaid,
        );
        if (!outcome.sent) {
          // ⚠ Not recorded: the history says what was sent to a printer, and this was not.
          setSaid(null);
          onError(outcome.message);
          return;
        }
        setSaid(`${outcome.message} On “${target.printer.name}”.`);
      } else if (action === 'downloaded') {
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
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-sm"
    >
      {/* What will come out, and the way to throw it away. */}
      <div className="flex min-h-8 items-center justify-between gap-2">
        <p className="min-w-0 text-sm font-semibold">{summary}</p>
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

      {/*
        The two numbers that change the result, one to a row with its label on
        the left: in a column this narrow, a field beside a field leaves one of
        them a stub. Copies is a stepper, because it is nearly always 1, 2 or 3
        and a press is quicker than typing into a small box.
      */}
      <div className="flex flex-col gap-2 border-y border-border py-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={copiesInput} className="text-sm text-muted-foreground">
            Copies
          </label>
          <div className="flex h-9 items-stretch overflow-hidden rounded-lg border border-border bg-background shadow-xs focus-within:ring-2 focus-within:ring-ring">
            <button
              type="button"
              aria-label="One copy fewer"
              className="flex w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
              disabled={copies <= 1}
              onClick={() => onCopies(clampCopies(copies - 1))}
            >
              <Minus aria-hidden="true" className="size-3.5" />
            </button>
            <input
              id={copiesInput}
              type="number"
              inputMode="numeric"
              min={1}
              max={COPIES_MAX}
              className="w-11 border-x border-border bg-transparent text-center text-sm font-medium tabular-nums focus-visible:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              value={copies}
              onChange={(event) => onCopies(clampCopies(Number(event.target.value)))}
            />
            <button
              type="button"
              aria-label="One copy more"
              className="flex w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
              disabled={copies >= COPIES_MAX}
              onClick={() => onCopies(clampCopies(copies + 1))}
            >
              <Plus aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        </div>
        {calibrations && calibrations.length > 0 && onCalibration ? (
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={calibrationInput} className="shrink-0 text-sm text-muted-foreground">
              Calibration
            </label>
            <select
              id={calibrationInput}
              className={cn(INPUT_CLASS, 'h-9 min-w-0 max-w-40 flex-1')}
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

      {/*
        Print and Printers share a row in equal halves, and Download has one to
        itself: every edge lines up with the card's, at any width. Print takes
        the whole row when there is no printer to offer.
      */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className={cn(buttonClass('secondary'), 'min-w-0 px-2', printing.printers.length > 0 ? '' : 'col-span-2')}
          disabled={disabled}
          onClick={() => void run('sent_to_print')}
        >
          <Printer aria-hidden="true" className="size-4" />
          Print
        </button>
        <PrinterMenu
          printers={printing.printers}
          onOpen={printing.refresh}
          disabled={disabled}
          triggerClassName={cn(buttonClass('secondary'), 'min-w-0 px-2')}
          describe={(printer) =>
            `${summary.replace(/\.$/u, '')}, on the computer “${printer.computer}”, at actual size.`
          }
          onPrint={(printer, settings) => void run('sent_to_print', { printer, settings })}
        />
        <button
          type="button"
          className={cn(buttonClass('primary'), 'col-span-2 min-w-0')}
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

/** The most copies one result may hold. Past this it is a number typed wrong. */
const COPIES_MAX = 99;

/** A number of copies from whatever was typed or stepped to: whole, and between 1 and the most. */
export function clampCopies(value: number): number {
  return Math.min(Math.max(Math.trunc(value) || 1, 1), COPIES_MAX);
}

/** One of the workspace's printers and what was chosen for this print on it. */
interface StudioPrintTarget {
  printer: PrinterChoice;
  settings: Readonly<Record<string, string>>;
}
