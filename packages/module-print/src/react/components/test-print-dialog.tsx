'use client';

import { cn } from '@kwtech/web-ui/react';
import { Ruler } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { RULER_FROM_LEFT, RULER_FROM_TOP, rulerLineLength, rulerPagePdf } from '../../domain/ruler.js';
import type { PrintClient, PrintJobView, PrintPrinterView, PrintScopeView } from '../print-client.js';
import { printThroughAgent } from '../print-flow.js';
import { buttonClass, INPUT_CLASS } from '../ui.js';
import { defaultRulerPaper, jobStatusText, millimetres, paperOptionText, toneBadgeClass } from '../view.js';
import { Modal } from './modal.js';

/**
 * A test print for one printer: the ruler page, which proves it prints at
 * exact size. Choose a paper, print, and measure.
 *
 * It says what to measure BEFORE and after, because the person reads this
 * once and then walks to the printer with a ruler.
 *
 * ⚠ THE PAGE IS MADE IN THE BROWSER AND KEPT NOWHERE (`rulerPagePdf`).
 * ⚠ One at a time, and the outcome stays until the next press.
 */
export function TestPrintDialog({
  printer,
  computer,
  blocked,
  api,
  scope,
  onClose,
}: {
  /** The printer to test, or null: closed. */
  printer: PrintPrinterView | null;
  computer: string;
  /** Why it cannot be printed on right now, or null when it can. */
  blocked: string | null;
  api: PrintClient;
  scope: PrintScopeView;
  onClose: () => void;
}) {
  const paperId = useId();
  const [paperName, setPaperName] = useState('');
  const [working, setWorking] = useState(false);
  const [job, setJob] = useState<PrintJobView | null | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | null>(null);

  // Another printer is another test: nothing of the last one carries over.
  const printerId = printer?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the PRINTER changes, not when its papers are re-read under an open dialog.
  useEffect(() => {
    setPaperName(printer ? (defaultRulerPaper(printer.papers)?.name ?? '') : '');
    setJob(undefined);
    setRefusal(null);
  }, [printerId]);

  const papers = printer?.papers ?? [];
  // The printer's papers can change under an open dialog; a paper that went away is not printed on.
  const paper = papers.find((one) => one.name === paperName) ?? defaultRulerPaper(papers);
  const said = job === undefined ? null : jobStatusText(job);
  const line = paper ? millimetres(rulerLineLength(paper)) : null;

  async function print() {
    if (!printer || !paper || working) return;
    setWorking(true);
    setRefusal(null);
    setJob(undefined);
    try {
      await printThroughAgent(
        api,
        scope,
        { printerId: printer.id, paperName: paper.name, copies: 1 },
        rulerPagePdf(paper),
        setJob,
      );
    } catch (caught) {
      setRefusal(caught instanceof Error ? caught.message : 'That did not work.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal
      open={printer !== null}
      busy={working}
      title={printer ? `Test ${printer.name}` : 'Test print'}
      description={`A ruler page, printed through “${computer}”, to check this printer prints at exact size.`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} disabled={working} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={working || blocked !== null || !paper}
            onClick={() => void print()}
          >
            <Ruler aria-hidden="true" className="size-4" />
            {working ? 'Printing…' : said ? 'Print it again' : 'Print the ruler page'}
          </button>
        </>
      }
    >
      <label htmlFor={paperId} className="flex flex-col gap-1.5 text-sm font-medium">
        Paper in the tray
        <select
          id={paperId}
          className={INPUT_CLASS}
          value={paper?.name ?? ''}
          disabled={working || papers.length === 0}
          onChange={(event) => setPaperName(event.target.value)}
        >
          {papers.map((one) => (
            <option key={one.name} value={one.name}>
              {paperOptionText(one)}
            </option>
          ))}
        </select>
      </label>

      {line ? (
        <div className="rounded-xl border border-border bg-background p-3 text-sm">
          <p className="font-medium">Then measure the page with a ruler</p>
          <ul className="mt-1.5 flex flex-col gap-1 text-muted-foreground">
            <li>
              Both lines: <strong className="font-semibold text-foreground">{line} mm</strong> long
            </li>
            <li>
              Left edge of the paper to the corner:{' '}
              <strong className="font-semibold text-foreground">{millimetres(RULER_FROM_LEFT)} mm</strong>
            </li>
            <li>
              Top edge of the paper to the corner:{' '}
              <strong className="font-semibold text-foreground">{millimetres(RULER_FROM_TOP)} mm</strong>
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Lines that are short or long mean the printer resized the page. Check its printing preferences on that
            computer.
          </p>
        </div>
      ) : null}

      {blocked ? <p className="text-sm text-muted-foreground">{blocked}</p> : null}
      {refusal ? (
        <p role="alert" className="rounded-lg bg-status-error px-3 py-2 text-sm text-status-error-foreground">
          {refusal}
        </p>
      ) : null}
      {said ? (
        <p role="status" className={cn('rounded-lg px-3 py-2 text-sm', toneBadgeClass(said.tone))}>
          {said.label}
        </p>
      ) : null}
    </Modal>
  );
}
