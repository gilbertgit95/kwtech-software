'use client';

import { type PrinterChoice, zonedDayKey } from '@kwtech/module-kit';
import { usePrinters } from '@kwtech/module-kit/react';
import { PRINTER_MENU_SELECT_CLASS, PrinterMenu } from '@kwtech/web-ui/react';
import { Download, Printer } from 'lucide-react';
import { useId, useState } from 'react';
import type { PosCatalogueView } from '../pos-client.js';
import { makePriceListPdf } from '../render/price-list-pdf.js';
import type { TillState } from '../use-till.js';
import {
  PRICE_LIST_PAPERS,
  type PriceListPaper,
  priceListCsvRows,
  priceListFileName,
  priceListHtml,
} from '../view/price-list.js';
import { toCsv } from '../view/reports.js';
import { buttonClass } from './controls.js';
import { Alert } from './layout.js';
import { downloadCsv, printHtml } from './till.js';

/**
 * The whole price list on paper or as a file (`view/price-list.ts`): every
 * item the till sells, by category, whatever the search box says.
 *
 * - **Print price list** goes through the receipt's hidden frame, so the
 *   browser's dialog can also save it as a PDF.
 * - **Printers** sends it to one of the workspace's own printers, through the
 *   computer it is paired to: `usePrinters` from module-kit and `PrinterMenu`
 *   from web-ui, the print studio's menu. Shown only when the app bound the
 *   port AND there is a printer this person may use.
 * - **CSV** for a spreadsheet.
 */
export function PriceListButtons({ state, catalogue }: { state: TillState; catalogue: PosCatalogueView }) {
  const { scope, timeZone } = state;
  const printing = usePrinters(scope);
  const paperId = useId();
  const [paperKey, setPaperKey] = useState<PriceListPaper['key']>('a4');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function printOn(printer: PrinterChoice, settings: Readonly<Record<string, string>>) {
    const paper = PRICE_LIST_PAPERS.find((one) => one.key === paperKey) ?? PRICE_LIST_PAPERS[0];
    setProblem(null);
    setBusy(true);
    setSaid('Making the PDF…');
    try {
      const pdf = await makePriceListPdf(catalogue, paper, new Date(), timeZone);
      setSaid('Reaching the printer…');
      const outcome = await printing.print(
        { printerId: printer.id, pdf, width: paper.width, height: paper.height, settings },
        setSaid,
      );
      if (!outcome.sent) {
        setSaid(null);
        setProblem(outcome.message);
        return;
      }
      setSaid(`${outcome.message} On “${printer.name}”.`);
    } catch (caught) {
      setSaid(null);
      setProblem(caught instanceof Error ? caught.message : 'Could not print the price list.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={buttonClass('secondary', 'sm')}
        onClick={() => printHtml(priceListHtml(catalogue, new Date(), timeZone))}
      >
        <Printer aria-hidden="true" className="size-4" />
        Print price list
      </button>
      <PrinterMenu
        printers={printing.printers}
        onOpen={printing.refresh}
        disabled={busy}
        triggerClassName={buttonClass('secondary', 'sm')}
        align="end"
        describe={(printer) => `The whole price list, on the computer “${printer.computer}”.`}
        fields={
          // The port takes a page size, not a paper: the size in the tray, which the printer must report.
          <label htmlFor={paperId} className="flex flex-col gap-1 text-xs font-medium">
            Paper size
            <select
              id={paperId}
              className={PRINTER_MENU_SELECT_CLASS}
              value={paperKey}
              onChange={(event) => {
                const next = PRICE_LIST_PAPERS.find((one) => one.key === event.target.value);
                if (next) setPaperKey(next.key);
              }}
            >
              {PRICE_LIST_PAPERS.map((paper) => (
                <option key={paper.key} value={paper.key}>
                  {paper.label}
                </option>
              ))}
            </select>
          </label>
        }
        onPrint={(printer, settings) => void printOn(printer, settings)}
      />
      <button
        type="button"
        className={buttonClass('secondary', 'sm')}
        onClick={() =>
          downloadCsv(priceListFileName(zonedDayKey(new Date(), timeZone)), toCsv(priceListCsvRows(catalogue)))
        }
      >
        <Download aria-hidden="true" className="size-4" />
        CSV
      </button>
      {said ? (
        <p role="status" className="basis-full text-xs text-muted-foreground">
          {said}
        </p>
      ) : null}
      {problem ? (
        <div className="basis-full">
          <Alert message={problem} onDismiss={() => setProblem(null)} />
        </div>
      ) : null}
    </>
  );
}
