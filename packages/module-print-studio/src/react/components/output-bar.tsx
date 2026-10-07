'use client';

import {
  ConfirmDialog,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import { ChevronDown, Download, Minus, Monitor, Plus, Printer, RotateCcw } from 'lucide-react';
import { type RefObject, useEffect, useId, useState } from 'react';
import type { StudioLogEntry } from '../../domain/log.js';
import { type StudioPrinterChoice, useStudioPrinter } from '../printer-port.js';
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
 *                 it is connected to (`printer-port.tsx`). A menu of them,
 *                 by computer; choosing one opens that printer's settings
 *                 for this print (paper type, quality), and Print there
 *                 sends it. ⚠ The button exists only when the app bound the
 *                 port AND there is a printer to offer; otherwise this bar
 *                 is what it always was.
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
   * The workspace's printers, when the app bound a way to reach them. Read
   * when the bar appears, each time the menu is opened and after each print,
   * so a computer switched on since shows without leaving the page.
   */
  const port = useStudioPrinter();
  const scope = state.scope;
  const [printers, setPrinters] = useState<readonly StudioPrinterChoice[]>([]);
  const [printersRead, setPrintersRead] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `printersRead` is the "read again" signal, not a value used.
  useEffect(() => {
    if (!port) return;
    let current = true;
    void port.printers(scope).then((found) => {
      if (current) setPrinters(found);
    });
    return () => {
      current = false;
    };
  }, [port, scope, printersRead]);

  /*
   * The printer whose settings are open, and what was last chosen on each.
   *
   * ⚠ REMEMBERED FOR THIS PAGE ONLY, per printer: the second sheet of glossy
   * should not need the choice made again, and a choice kept past the page
   * would outlive the paper in the tray.
   */
  const [picked, setPicked] = useState<StudioPrinterChoice | null>(null);
  const [choices, setChoices] = useState<Readonly<Record<string, Readonly<Record<string, string>>>>>({});
  const pickedChoices = picked ? settingChoices(picked, choices[picked.id]) : {};

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
      if (action === 'sent_to_print' && port && target) {
        setSaid('Reaching the printer…');
        const outcome = await port.print(
          scope,
          {
            printerId: target.printer.id,
            pdf: new Uint8Array(await ready.pdf.arrayBuffer()),
            width: ready.sheet.width,
            height: ready.sheet.height,
            settings: target.settings,
          },
          setSaid,
        );
        setPrintersRead((count) => count + 1);
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
          className={cn(buttonClass('secondary'), 'min-w-0 px-2', port && printers.length > 0 ? '' : 'col-span-2')}
          disabled={disabled}
          onClick={() => void run('sent_to_print')}
        >
          <Printer aria-hidden="true" className="size-4" />
          Print
        </button>
        {port && printers.length > 0 ? (
          <DropdownMenu onOpenChange={(open) => (open ? setPrintersRead((count) => count + 1) : undefined)}>
            <DropdownMenuTrigger asChild>
              <button type="button" className={cn(buttonClass('secondary'), 'min-w-0 px-2')} disabled={disabled}>
                <Monitor aria-hidden="true" className="size-4" />
                Printers
                <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-xs">
              {printersByComputer(printers).map((group) => (
                <div key={group.computer}>
                  <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                    {group.computer}
                    {group.blocked ? ' — cannot print now' : ''}
                  </DropdownMenuLabel>
                  {group.printers.map((printer) => (
                    <DropdownMenuItem
                      key={printer.id}
                      disabled={printer.blocked !== null}
                      title={printer.blocked ?? undefined}
                      onSelect={() => setPicked(printer)}
                    >
                      <Printer aria-hidden="true" />
                      <span className="min-w-0 truncate">{printer.name}</span>
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
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

      {/* The printer's settings for this one print. Opened from the menu; Print here is what sends it. */}
      <ConfirmDialog
        open={picked !== null}
        danger={false}
        title={picked ? `Print on ${picked.name}` : 'Print'}
        confirmLabel="Print"
        description={
          picked ? (
            <div className="flex flex-col gap-3">
              <p>
                {summary.replace(/\.$/u, '')}, on the computer “{picked.computer}”, at actual size.
              </p>
              {picked.settings.map((setting) => (
                <label key={setting.key} className="flex flex-col gap-1 text-xs font-medium">
                  {setting.label}
                  <select
                    className={cn(INPUT_CLASS, 'h-9 text-sm font-normal text-foreground')}
                    value={pickedChoices[setting.key] ?? ''}
                    onChange={(event) =>
                      setChoices((all) => ({
                        ...all,
                        [picked.id]: { ...settingChoices(picked, all[picked.id]), [setting.key]: event.target.value },
                      }))
                    }
                  >
                    {/* Offered only when what the printer is set to is not known: otherwise that is where it starts. */}
                    {setting.initial === null ? <option value="">As the printer is set</option> : null}
                    {setting.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.id === setting.initial ? ' (the printer’s own)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {picked.settings.length === 0 ? (
                <p>This printer offers no settings here. It prints as it is set on its computer.</p>
              ) : (
                <p className="text-xs">
                  These apply to this print only. Load that paper first: the printer cannot tell what is in its tray.
                </p>
              )}
            </div>
          ) : null
        }
        onCancel={() => setPicked(null)}
        onConfirm={() => {
          if (!picked) return;
          const target = { printer: picked, settings: chosenSettings(pickedChoices) };
          setPicked(null);
          void run('sent_to_print', target);
        }}
      />

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
  printer: StudioPrinterChoice;
  settings: Readonly<Record<string, string>>;
}

/**
 * Where each of a printer's settings stands: what was last chosen on this
 * page, while the printer still offers it, else what the printer is set to.
 * '' is "leave it as the printer is set".
 */
export function settingChoices(
  printer: Pick<StudioPrinterChoice, 'settings'>,
  kept: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const choices: Record<string, string> = {};
  for (const setting of printer.settings) {
    const last = kept[setting.key];
    const offered = last !== undefined && (last === '' || setting.options.some((option) => option.id === last));
    choices[setting.key] = offered ? last : (setting.initial ?? '');
  }
  return choices;
}

/** The choices to send: the ones left "as the printer is set" are not sent at all. */
export function chosenSettings(choices: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(choices).filter(([, id]) => id !== ''));
}

/** The printers under the computer each is on, in the order they came. A computer is blocked when all of its are. */
export function printersByComputer(
  printers: readonly StudioPrinterChoice[],
): { computer: string; blocked: boolean; printers: StudioPrinterChoice[] }[] {
  const groups = new Map<string, StudioPrinterChoice[]>();
  for (const printer of printers) {
    groups.set(printer.computer, [...(groups.get(printer.computer) ?? []), printer]);
  }
  return [...groups].map(([computer, list]) => ({
    computer,
    blocked: list.every((printer) => printer.blocked !== null),
    printers: list,
  }));
}
