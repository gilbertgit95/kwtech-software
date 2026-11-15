'use client';

import type { PrinterChoice, PrinterOutcome, ReceiptPrinterChoice } from '@kwtech/module-kit';
import { usePrinters, useReceiptPrinters, useWorkspaceName } from '@kwtech/module-kit/react';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import { ChevronDown, Globe, Printer, ReceiptText } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PosOrderView, PosScopeView } from '../pos-client.js';
import { receiptHtml } from '../view/receipt.js';
import { pickedReceiptPrinter, receiptLines, receiptPrinterDetail, receiptTargetText } from '../view/receipt-lines.js';
import { buttonClass } from './controls.js';
import { printHtml } from './print-frame.js';

/**
 * Printing a sale's receipt (#144, R5): on a thermal receipt printer through
 * the print agent, as text, with one tap.
 *
 * - **The printer is picked** by the binder (`module-print`), as agreed in
 *   #144: this device's choice → the workspace default → the only receipt
 *   printer online → otherwise ask. A document printer is never picked.
 * - **The menu** (▾) lists every receipt printer with its computer, width and
 *   status, offline ones greyed with since when; choosing one prints on it and
 *   makes it this device's. Then "Other printers (prints as a page)", the
 *   narrow-page fallback; then the browser's own print, always there.
 * - **Unbound, or no printers at all,** it is the browser's print, as before.
 *
 * ⚠ ONE TAP, ONE RECEIPT. The button is disabled while a receipt is on its
 * way: a second tap on a slow network is a second receipt in the customer's
 * hand.
 */

/** What the hook hands its button, and the till's keyboard shortcut. */
export interface ReceiptPrintState {
  order: PosOrderView | null;
  reprint: boolean;
  /** False: nothing is bound or no printer is paired; the button is the browser's print. */
  usesPrinters: boolean;
  receiptPrinters: readonly ReceiptPrinterChoice[];
  documentPrinters: readonly PrinterChoice[];
  /** Where a tap prints, or null when it must ask. */
  target: ReceiptPrinterChoice | null;
  /** Why it asks, when it does. */
  askReason: string | null;
  busy: boolean;
  /** The last outcome, or a step on the way. */
  said: { text: string; ok: boolean | null } | null;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  /** The one tap: on the picked printer, or open the menu to ask. */
  printNow: () => void;
  printOn: (printerId: string) => void;
  printAsPage: (printerId: string) => void;
  printInBrowser: () => void;
  timeZone: string;
}

/**
 * The receipt printing for one order, or none (`null`: nothing to print yet).
 *
 * `autoAfterPayment`: print once, by itself, when THIS screen sees the order
 * go from open to paid (the device's "Always print after payment"). Never on
 * an order that was already paid when it appeared: a reload must not print a
 * second receipt.
 */
export function useReceiptPrint(
  order: PosOrderView | null,
  options: { scope: PosScopeView; timeZone: string; reprint?: boolean; autoAfterPayment?: boolean },
): ReceiptPrintState {
  const { scope, timeZone } = options;
  const reprint = options.reprint ?? false;
  const storeName = useWorkspaceName();
  const receipts = useReceiptPrinters(scope);
  const documents = usePrinters(scope);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<ReceiptPrintState['said']>(null);
  const [menuOpen, setMenuOpenState] = useState(false);
  const inFlight = useRef(false);

  const receiptPrinters = receipts.printing?.printers ?? [];
  const pick = receipts.printing?.pick ?? null;
  const target = pick ? pickedReceiptPrinter(receiptPrinters, pick) : null;
  const usesPrinters = receipts.bound && (receiptPrinters.length > 0 || documents.printers.length > 0);

  // A different order, a fresh line under the button.
  const orderId = order?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per ORDER, not when it is re-read.
  useEffect(() => setSaid(null), [orderId]);

  const lines = useCallback(
    (current: PosOrderView) => receiptLines(current, { timeZone, storeName, reprintedAt: reprint ? new Date() : null }),
    [timeZone, storeName, reprint],
  );

  const run = useCallback(
    /** `send` hands back null when it asked instead of printing: the line under the button then says why. */
    async (send: (current: PosOrderView) => Promise<PrinterOutcome | null>) => {
      if (!order || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setSaid({ text: 'Reaching the printer…', ok: null });
      try {
        const outcome = await send(order);
        setSaid(outcome ? { text: outcome.message, ok: outcome.sent } : null);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [order],
  );

  const printOn = useCallback(
    (printerId: string) => {
      // Chosen in the menu: this device's printer from now on, so the next tap needs no menu.
      receipts.choose(printerId);
      void run((current) => receipts.print(printerId, lines(current), (text) => setSaid({ text, ok: null })));
    },
    [receipts, run, lines],
  );
  const printAsPage = useCallback(
    (printerId: string) =>
      void run((current) => receipts.printAsPage(printerId, lines(current), (text) => setSaid({ text, ok: null }))),
    [receipts, run, lines],
  );
  const printInBrowser = useCallback(() => {
    if (!order) return;
    printHtml(receiptHtml(order, { timeZone, storeName, reprintedAt: reprint ? new Date() : null }));
  }, [order, timeZone, storeName, reprint]);

  const setMenuOpen = useCallback(
    (open: boolean) => {
      // Opened: read again, so a computer switched on since shows without leaving the page.
      if (open) {
        receipts.refresh();
        documents.refresh();
      }
      setMenuOpenState(open);
    },
    [receipts, documents],
  );

  /**
   * ⚠ DECIDED ON A FRESH READ, not on the list on screen: read minutes ago,
   * it would send the receipt to a computer switched off since (found by the
   * browser test, #144 R5). The read is one small query; a receipt is worth it.
   */
  const printNow = useCallback(() => {
    if (!order || inFlight.current) return;
    if (!usesPrinters) {
      printInBrowser();
      return;
    }
    void run(async (current) => {
      const fresh = await receipts.read();
      const chosen = fresh ? pickedReceiptPrinter(fresh.printers, fresh.pick) : null;
      if (!chosen) {
        setMenuOpen(true);
        return null;
      }
      return receipts.print(chosen.id, lines(current), (text) => setSaid({ text, ok: null }));
    });
  }, [order, usesPrinters, printInBrowser, setMenuOpen, run, receipts, lines]);

  // "Always print after payment": once, when this screen saw the order paid.
  const seen = useRef<{ id: string; status: string } | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = order ? { id: order.id, status: order.status } : null;
    if (!options.autoAfterPayment || !order || reprint || order.status !== 'paid') return;
    if (before?.id !== order.id || before.status === 'paid') return;
    // Only to the printer it would pick: never a menu nobody asked for, never a page.
    if (target && target.blocked === null) printNow();
  }, [order, options.autoAfterPayment, reprint, target, printNow]);

  return {
    order,
    reprint,
    usesPrinters,
    receiptPrinters,
    documentPrinters: documents.printers,
    target,
    askReason: pick?.kind === 'ask' ? pick.reason : null,
    busy,
    said,
    menuOpen,
    setMenuOpen,
    printNow,
    printOn,
    printAsPage,
    printInBrowser,
    timeZone,
  };
}

/**
 * "Print receipt ▾", with where it prints under it and how it went. Looks
 * only: the hook does the work, so the till's shortcut presses the same
 * button.
 */
export function ReceiptPrintButton({
  state,
  size = 'normal',
  className,
}: {
  state: ReceiptPrintState;
  /** `large` on a phone: a thumb's target. */
  size?: 'normal' | 'large';
  className?: string;
}) {
  // Read at each render: "offline since" says today's time as a time, an older one with its date.
  const now = new Date();
  // Inside a phone's sheet (a native <dialog>), the menu must open inside it, or it opens behind the sheet.
  const wrapper = useRef<HTMLDivElement>(null);
  const sheet = state.menuOpen ? (wrapper.current?.closest('dialog') ?? null) : null;
  const label = state.reprint ? 'Reprint receipt' : 'Print receipt';
  const height = size === 'large' ? 'h-12 text-base' : 'h-10';

  if (!state.usesPrinters) {
    return (
      <button
        type="button"
        className={cn(buttonClass('secondary'), height, className)}
        disabled={!state.order}
        onClick={state.printInBrowser}
      >
        <Printer aria-hidden="true" className="size-4" />
        {label}
      </button>
    );
  }

  return (
    <div ref={wrapper} className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="flex min-w-0">
        <button
          type="button"
          className={cn(buttonClass('secondary'), height, 'min-w-0 flex-1 rounded-r-none')}
          disabled={!state.order || state.busy}
          onClick={state.printNow}
        >
          <ReceiptText aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{state.busy ? 'Printing…' : label}</span>
        </button>
        <DropdownMenu open={state.menuOpen} onOpenChange={state.setMenuOpen}>
          <DropdownMenuTrigger
            className={cn(buttonClass('secondary'), height, 'rounded-l-none border-l-0 px-2')}
            disabled={!state.order || state.busy}
            aria-label="Choose the printer"
          >
            <ChevronDown aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            container={sheet}
            // In a sheet, kept inside it (the sheet clips what passes its edge), scrolling when it is taller.
            {...(sheet ? { collisionBoundary: sheet, collisionPadding: 8 } : {})}
            className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
          >
            {state.askReason ? (
              <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
                {state.askReason}
              </p>
            ) : null}
            <DropdownMenuLabel>Receipt printers</DropdownMenuLabel>
            {state.receiptPrinters.length === 0 ? (
              <p className="px-2 pb-1.5 text-xs text-muted-foreground">
                None yet. In the Printers app, choose “Use for receipts…” on a printer.
              </p>
            ) : null}
            {state.receiptPrinters.map((printer) => (
              <DropdownMenuItem
                key={printer.id}
                disabled={printer.blocked !== null}
                onSelect={() => state.printOn(printer.id)}
                className="items-start"
              >
                <ReceiptText aria-hidden="true" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {printer.name}
                    {state.target?.id === printer.id ? ' ✓' : ''}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {receiptPrinterDetail(printer, state.timeZone, now)}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
            {state.documentPrinters.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Other printers (prints as a page)</DropdownMenuLabel>
                {state.documentPrinters.map((printer) => (
                  <DropdownMenuItem
                    key={printer.id}
                    disabled={printer.blocked !== null}
                    onSelect={() => state.printAsPage(printer.id)}
                    className="items-start"
                  >
                    <Printer aria-hidden="true" className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block truncate">{printer.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {printer.blocked ?? `${printer.computer} · a narrow column on its paper`}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={state.printInBrowser}>
              <Globe aria-hidden="true" />
              Print from this browser
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p
        role="status"
        className={cn('truncate text-xs', state.said?.ok === false ? 'text-destructive' : 'text-muted-foreground')}
      >
        {state.said?.text ?? (state.target ? receiptTargetText(state.target) : (state.askReason ?? ''))}
      </p>
    </div>
  );
}

const AUTO_KEY = 'kwtech:pos-auto-receipt:';

/**
 * "Always print after payment", for this device and workspace: a cashier's
 * convenience kept in this browser. Storage that is not there (a private
 * window) is "off".
 */
export function useAutoReceipt(workspaceId: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      setOn(globalThis.localStorage?.getItem(AUTO_KEY + workspaceId) === 'on');
    } catch {
      setOn(false);
    }
  }, [workspaceId]);
  const set = useCallback(
    (next: boolean) => {
      setOn(next);
      try {
        if (next) globalThis.localStorage?.setItem(AUTO_KEY + workspaceId, 'on');
        else globalThis.localStorage?.removeItem(AUTO_KEY + workspaceId);
      } catch {
        // No storage here: on until the page reloads.
      }
    },
    [workspaceId],
  );
  return [on, set];
}
