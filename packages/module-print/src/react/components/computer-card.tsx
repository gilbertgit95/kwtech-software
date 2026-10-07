'use client';

import { cn } from '@kwtech/web-ui/react';
import { ChevronDown, Monitor, Printer, Ruler, Trash2 } from 'lucide-react';
import type { PrintAgentView, PrintPrinterView } from '../print-client.js';
import { buttonClass } from '../ui.js';
import {
  cannotPrintReason,
  paperMarginsText,
  paperSizeText,
  printerStatusText,
  splitPrinters,
  toneBadgeClass,
} from '../view.js';

/** When an offline computer was last heard from. The badge beside it already says "Offline". */
function lastSeenText(agent: Pick<PrintAgentView, 'lastSeenAt'>, seenText: string | null): string {
  return agent.lastSeenAt && seenText ? `Last seen ${seenText}` : 'Has not connected yet';
}

/** A small pill: one word of state, coloured by what it means. */
function Badge({ tone, children }: { tone: 'ok' | 'muted' | 'bad'; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        toneBadgeClass(tone),
      )}
    >
      {children}
    </span>
  );
}

/**
 * One paired computer: what it is, whether it can be reached, and its printers.
 *
 * - The printers it still has come first, as tiles. The ones it no longer
 *   reports are folded away under a count: they are a record, not a choice.
 * - "Test print" and "Revoke" are handed in already decided: this component
 *   does not know who may do what (`onTest` and `onRevoke` are left out for
 *   somebody who may not).
 */
export function ComputerCard({
  agent,
  seenText,
  busy,
  onRevoke,
  onTest,
}: {
  agent: PrintAgentView;
  /** The last-seen time, already formatted in the workspace's zone. */
  seenText: string | null;
  busy: boolean;
  onRevoke?: (() => void) | undefined;
  onTest?: ((printer: PrintPrinterView) => void) | undefined;
}) {
  const { present, gone } = splitPrinters(agent.printers);
  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl',
              agent.online ? 'bg-status-success text-status-success-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            <Monitor aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold">{agent.name}</h3>
              <Badge tone={agent.online ? 'ok' : 'muted'}>{agent.online ? 'Online' : 'Offline'}</Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {[agent.hostName, agent.online ? null : lastSeenText(agent, seenText)].filter(Boolean).join(' · ') ||
                `${present.length} ${present.length === 1 ? 'printer' : 'printers'}`}
            </p>
          </div>
        </div>
        {onRevoke ? (
          <button
            type="button"
            className={cn(buttonClass('ghost', 'sm'), 'text-muted-foreground hover:text-destructive')}
            disabled={busy}
            onClick={onRevoke}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            Revoke
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 p-4">
        {!agent.online ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            {agent.lastSeenAt
              ? 'This computer is not connected. Start the print agent on it to print.'
              : 'Paired, and waiting for the print agent to be started on it.'}
          </p>
        ) : null}

        {present.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {agent.lastSeenAt
              ? 'This computer has not reported any printers.'
              : 'Its printers show here once the agent is started on that computer.'}
          </p>
        ) : (
          <ul className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
            {present.map((printer) => (
              <PrinterTile
                key={printer.id}
                printer={printer}
                blocked={cannotPrintReason(agent, printer)}
                onTest={onTest ? () => onTest(printer) : undefined}
              />
            ))}
          </ul>
        )}

        {gone.length > 0 ? (
          <details className="group text-xs text-muted-foreground">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180" />
              {gone.length} no longer on this computer
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5 pl-5">
              {gone.map((printer) => (
                <li key={printer.id}>{printer.name}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </li>
  );
}

/**
 * One printer: its name and state, what it can take, and a test print.
 *
 * The papers, paper types and qualities are a driver's long lists, so they are
 * a count on the tile and the list behind "Details" — a person choosing a
 * printer wants its name and whether it is ready, not twenty-seven papers.
 */
function PrinterTile({
  printer,
  blocked,
  onTest,
}: {
  printer: PrintPrinterView;
  blocked: string | null;
  onTest?: (() => void) | undefined;
}) {
  const status = printerStatusText(printer);
  const facts = [
    printer.papers.length > 0 ? `${printer.papers.length} ${printer.papers.length === 1 ? 'paper' : 'papers'}` : null,
    printer.mediaTypes.length > 0 ? `${printer.mediaTypes.length} paper types` : null,
    printer.qualities.length > 0 ? `${printer.qualities.length} qualities` : null,
  ].filter((fact): fact is string => fact !== null);
  const hasDetails = printer.papers.length > 0 || printer.mediaTypes.length > 0 || printer.qualities.length > 0;

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Printer aria-hidden="true" className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={printer.name}>
            {printer.name}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={printer.driver}>
            {printer.driver || 'Driver not reported'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={status.tone}>{status.label}</Badge>
        {printer.isDefault ? <Badge tone="muted">Default</Badge> : null}
      </div>

      {facts.length > 0 ? <p className="text-xs text-muted-foreground">{facts.join(' · ')}</p> : null}

      {hasDetails ? (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180" />
            Details
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            <OptionList title="Paper types" options={printer.mediaTypes} current={printer.mediaType} />
            <OptionList title="Qualities" options={printer.qualities} current={printer.quality} />
            {printer.papers.length > 0 ? (
              <div>
                <p className="text-xs font-medium">Papers</p>
                <ul className="mt-1 flex max-h-44 flex-col gap-1 overflow-y-auto pr-1">
                  {printer.papers.map((paper) => (
                    <li key={paper.name} className="text-xs">
                      <span className="font-medium">{paper.name}</span>
                      <span className="block text-muted-foreground">
                        {paperSizeText(paper)} · {paperMarginsText(paper)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      {onTest && printer.papers.length > 0 ? (
        <div className="mt-auto flex flex-col gap-1.5 border-t border-border pt-3">
          <button
            type="button"
            className={cn(buttonClass('secondary', 'sm'), 'self-start')}
            disabled={blocked !== null}
            // Why it is off is said once, on the computer above, not under every printer.
            title={blocked ?? undefined}
            onClick={onTest}
          >
            <Ruler aria-hidden="true" className="size-3.5" />
            Test print
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** A driver's choices as chips, the one the printer is set to marked. Nothing when the driver named none. */
function OptionList({
  title,
  options,
  current,
}: {
  title: string;
  options: readonly { id: string; label: string }[];
  current: string | null;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium">{title}</p>
      <ul className="mt-1 flex flex-wrap gap-1">
        {options.map((option) => (
          <li
            key={option.id}
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs',
              option.id === current
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground',
            )}
            title={option.id === current ? 'What the printer is set to now' : undefined}
          >
            {option.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
