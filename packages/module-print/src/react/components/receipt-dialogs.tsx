'use client';

import { cn } from '@kwtech/web-ui/react';
import { ReceiptText } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { DEFAULT_RECEIPT_PROFILE, encodeReceipt, type ReceiptPaperWidth } from '../../domain/receipt.js';
import {
  type PrintReceiptSettings,
  prepareReceiptSettings,
  RECEIPT_PRINTER_LABEL_MAX,
  receiptPrinterName,
  receiptProfileOf,
  testReceiptLines,
} from '../../domain/receipt-printers.js';
import type {
  PrintClient,
  PrintJobView,
  PrintPrinterView,
  PrintReceiptSettingsView,
  PrintScopeView,
} from '../print-client.js';
import { printThroughAgent } from '../print-flow.js';
import { buttonClass, INPUT_CLASS } from '../ui.js';
import { jobStatusText, toneBadgeClass } from '../view.js';
import { Modal } from './modal.js';

/** What a new receipt printer starts with: the builder's default profile, the commonest counter printer. */
const NEW_RECEIPT: PrintReceiptSettingsView = { label: null, ...DEFAULT_RECEIPT_PROFILE };

/**
 * Marks a printer as a receipt printer, or changes how it prints receipts
 * (#144, R4). For somebody holding `print:manage_agents`; the API checks too.
 *
 * ⚠ A receipt printer prints receipts ONLY. The dialog says so before it is
 * saved, because the printer then disappears from document printing.
 */
export function ReceiptSettingsDialog({
  printer,
  busy,
  error,
  onSave,
  onClose,
}: {
  /** The printer being set up, or null: closed. */
  printer: PrintPrinterView | null;
  busy: boolean;
  error: string | null;
  /** The settings, or null to make it a document printer again. */
  onSave: (receipt: PrintReceiptSettingsView | null) => void;
  onClose: () => void;
}) {
  const labelId = useId();
  const [draft, setDraft] = useState<PrintReceiptSettingsView>(NEW_RECEIPT);
  const [problem, setProblem] = useState<string | null>(null);

  // A different printer, a different draft.
  const printerId = printer?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per PRINTER, not when its row is re-read under an open dialog.
  useEffect(() => {
    setDraft(printer?.receipt ?? NEW_RECEIPT);
    setProblem(null);
  }, [printerId]);

  const marked = printer?.receipt != null;

  function save() {
    const checked = prepareReceiptSettings(draft);
    if ('refused' in checked) {
      setProblem(`A name of at most ${RECEIPT_PRINTER_LABEL_MAX} characters, and a paper width of 58 or 80 mm.`);
      return;
    }
    setProblem(null);
    onSave(checked);
  }

  const toggle = (key: 'cutter' | 'drawer' | 'qr', label: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4"
        checked={draft[key]}
        disabled={busy}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })}
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );

  return (
    <Modal
      open={printer !== null}
      busy={busy}
      title={
        printer
          ? marked
            ? `Receipt settings: ${receiptPrinterName(printer)}`
            : `Use ${printer.name} for receipts`
          : 'Receipt printer'
      }
      description="A receipt printer prints receipts only, as text, fast. It is no longer offered for documents or the print studio."
      onClose={onClose}
      footer={
        <>
          {marked ? (
            <button
              type="button"
              className={cn(buttonClass('ghost'), 'mr-auto')}
              disabled={busy}
              onClick={() => onSave(null)}
            >
              Use for documents instead
            </button>
          ) : null}
          <button type="button" className={buttonClass('ghost')} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={buttonClass('primary')} disabled={busy} onClick={save}>
            {busy ? 'Saving…' : marked ? 'Save' : 'Use for receipts'}
          </button>
        </>
      }
    >
      <label htmlFor={labelId} className="flex flex-col gap-1.5 text-sm font-medium">
        Name for its place
        <input
          id={labelId}
          className={INPUT_CLASS}
          value={draft.label ?? ''}
          maxLength={RECEIPT_PRINTER_LABEL_MAX}
          placeholder={printer?.name ?? 'Counter 1'}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, label: event.target.value || null })}
        />
        <span className="text-xs font-normal text-muted-foreground">
          What a cashier picks it by, such as “Counter 1” or “Kitchen”. Empty: its name on the computer.
        </span>
      </label>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Paper width</legend>
        <div className="flex gap-2">
          {([80, 58] as const satisfies readonly ReceiptPaperWidth[]).map((width) => (
            <label
              key={width}
              className={cn(
                'flex flex-1 cursor-pointer flex-col rounded-xl border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                draft.paperWidth === width ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/60',
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={`${labelId}-width`}
                checked={draft.paperWidth === width}
                disabled={busy}
                onChange={() => setDraft({ ...draft, paperWidth: width })}
              />
              <span className="font-medium">{width} mm</span>
              <span className="text-xs text-muted-foreground">
                {width === 80 ? 'Counter printers · 48 characters' : 'Small and portable · 32 characters'}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2.5">
        {toggle('cutter', 'It cuts the paper', 'Without a cutter, each receipt feeds out to tear off.')}
        {toggle('drawer', 'A cash drawer is plugged into it', 'Receipts that open the drawer will open it.')}
        {toggle('qr', 'It prints QR codes', 'Most printers made since about 2015 do. Without, the code’s text prints.')}
      </div>

      {(problem ?? error) ? (
        <p role="alert" className="rounded-lg bg-status-error px-3 py-2 text-sm text-status-error-foreground">
          {problem ?? error}
        </p>
      ) : null}
    </Modal>
  );
}

/**
 * Prints the Test receipt (`testReceiptLines`) on a receipt printer, as text,
 * through its computer: one roll that shows whether the width, the cutter,
 * the drawer and the QR code are set up right.
 */
export function TestReceiptDialog({
  printer,
  computer,
  blocked,
  api,
  scope,
  timeZone,
  onClose,
}: {
  printer: (PrintPrinterView & { receipt: PrintReceiptSettings }) | null;
  computer: string;
  blocked: string | null;
  api: PrintClient;
  scope: PrintScopeView;
  /** The workspace's zone: the time on the receipt is the moment Print is pressed, there. */
  timeZone: string;
  onClose: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [job, setJob] = useState<PrintJobView | null | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | null>(null);
  const printerId = printer?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: another printer is another test.
  useEffect(() => {
    setJob(undefined);
    setRefusal(null);
  }, [printerId]);
  const said = job === undefined ? null : jobStatusText(job);

  async function print() {
    if (!printer || working) return;
    setWorking(true);
    setRefusal(null);
    setJob(undefined);
    try {
      const printedAt = new Date().toLocaleString(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
      const bytes = encodeReceipt(testReceiptLines(printer, printedAt), receiptProfileOf(printer.receipt));
      await printThroughAgent(
        api,
        scope,
        { printerId: printer.id, paperName: null, copies: 1, format: 'escpos' },
        bytes,
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
      title={printer ? `Test receipt: ${receiptPrinterName(printer)}` : 'Test receipt'}
      description={`A sample receipt, printed through “${computer}”: check that the ruler of digits fits one line, and the cutter, drawer and QR code.`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} disabled={working} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={working || blocked !== null}
            onClick={() => void print()}
          >
            <ReceiptText aria-hidden="true" className="size-4" />
            {working ? 'Printing…' : said ? 'Print it again' : 'Print the test receipt'}
          </button>
        </>
      }
    >
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
