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
  /** The printers are being read for the first time: the button waits. */
  loading: boolean;
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
  /** "Always print after payment", called with the order THIS screen just paid. */
  printAfterPayment: (paid: PosOrderView) => void;
  printOn: (printerId: string) => void;
  printAsPage: (printerId: string) => void;
  printInBrowser: () => void;
  timeZone: string;
}

/**
 * The receipt printing for one order, or none (`null`: nothing to print yet).
 *
 * ⚠ ONE ORIGINAL. Once a receipt for this order has gone to a printer from
 * this screen, every later print of it is a copy: marked REPRINT with its
 * time, and it never opens the drawer. A second tap must not hand out a
 * second original, nor the till.
 */
export function useReceiptPrint(
  order: PosOrderView | null,
  options: { scope: PosScopeView; timeZone: string; reprint?: boolean },
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
  /** Orders whose original receipt this screen has printed. */
  const originals = useRef(new Set<string>());

  const receiptPrinters = receipts.printing?.printers ?? [];
  const pick = receipts.printing?.pick ?? null;
  const target = pick ? pickedReceiptPrinter(receiptPrinters, pick) : null;
  /** Bound but not read yet: neither the browser's print nor a printer, until it is known which. */
  const loading = receipts.bound && receipts.printing === null;
  const usesPrinters = receipts.bound && (receiptPrinters.length > 0 || documents.printers.length > 0);

  // Another order, a fresh line under the button. ⚠ Not on null: a reprint's order is null while it reads again.
  const lastOrderId = useRef<string | null>(null);
  const orderId = order?.id ?? null;
  useEffect(() => {
    if (orderId === null || orderId === lastOrderId.current) return;
    lastOrderId.current = orderId;
    setSaid(null);
  }, [orderId]);

  const isCopy = useCallback((current: PosOrderView) => reprint || originals.current.has(current.id), [reprint]);
  const lines = useCallback(
    (current: PosOrderView) =>
      receiptLines(current, { timeZone, storeName, reprintedAt: isCopy(current) ? new Date() : null }),
    [timeZone, storeName, isCopy],
  );

  /** The receipt on its way now, if any: what an automatic print waits for rather than being dropped. */
  const active = useRef<Promise<void>>(Promise.resolve());
  const run = useCallback(
    /** `send` hands back null when it asked instead of printing: the line under the button then says why. */
    (send: (current: PosOrderView) => Promise<PrinterOutcome | null>, current: PosOrderView | null = order) => {
      if (!current || inFlight.current) return active.current;
      inFlight.current = true;
      setBusy(true);
      setSaid({ text: 'Reaching the printer…', ok: null });
      const going = (async () => {
        try {
          const outcome = await send(current);
          if (outcome?.sent) originals.current.add(current.id);
          setSaid(outcome ? { text: outcome.message, ok: outcome.sent } : null);
        } catch (caught) {
          setSaid({ text: caught instanceof Error ? caught.message : 'Could not print the receipt.', ok: false });
        } finally {
          inFlight.current = false;
          setBusy(false);
        }
      })();
      active.current = going;
      return going;
    },
    [order],
  );

  const onStep = useCallback((text: string) => setSaid({ text, ok: null }), []);
  const printOn = useCallback(
    (printerId: string) => {
      // Chosen in the menu: this device's printer from now on, so the next tap needs no menu.
      receipts.choose(printerId);
      void run((current) => receipts.print(printerId, lines(current), onStep));
    },
    [receipts, run, lines, onStep],
  );
  const printAsPage = useCallback(
    (printerId: string) => void run((current) => receipts.printAsPage(printerId, lines(current), onStep)),
    [receipts, run, lines, onStep],
  );
  const printInBrowser = useCallback(() => {
    if (!order) return;
    printHtml(receiptHtml(order, { timeZone, storeName, reprintedAt: isCopy(order) ? new Date() : null }));
  }, [order, timeZone, storeName, isCopy]);

  const { refresh: refreshReceipts } = receipts;
  const { refresh: refreshDocuments } = documents;
  const setMenuOpen = useCallback(
    (open: boolean) => {
      // Opened: read again, so a computer switched on since shows without leaving the page.
      if (open) {
        refreshReceipts();
        refreshDocuments();
      }
      setMenuOpenState(open);
    },
    [refreshReceipts, refreshDocuments],
  );

  /**
   * Where this receipt goes now, on a fresh read, or why it cannot go there.
   *
   * ⚠ DECIDED ON A FRESH READ, not on the list on screen: read minutes ago,
   * it would send the receipt to a computer switched off since (found by the
   * browser test, #144 R5).
   */
  const decide = useCallback(async (): Promise<{ printerId: string } | { reason: string }> => {
    const fresh = await receipts.read();
    const chosen = fresh ? pickedReceiptPrinter(fresh.printers, fresh.pick) : null;
    if (chosen) return { printerId: chosen.id };
    return { reason: fresh?.pick.kind === 'ask' ? fresh.pick.reason : 'Choose a receipt printer.' };
  }, [receipts]);

  const printNow = useCallback(() => {
    if (!order || inFlight.current || loading) return;
    if (!usesPrinters) {
      printInBrowser();
      return;
    }
    void run(async (current) => {
      const where = await decide();
      if ('reason' in where) {
        // The read just happened: open the menu on it, without reading again.
        setMenuOpenState(true);
        return null;
      }
      return receipts.print(where.printerId, lines(current), onStep);
    });
  }, [order, loading, usesPrinters, printInBrowser, run, decide, receipts, lines, onStep]);

  /**
   * "Always print after payment": called by the screen that TOOK the payment,
   * with the order it paid, never by a screen that only heard about it (a
   * second till would print a second original, and open its drawer).
   * ⚠ Never opens a menu nobody asked for: when it cannot print, it says so.
   */
  const printAfterPayment = useCallback(
    (paid: PosOrderView) => {
      if (paid.status !== 'paid' || !receipts.bound) return;
      // ⚠ Queued behind a receipt still on its way (a quick next sale), never dropped: a tap may be refused while busy, this may not.
      const print = () =>
        run(async (current) => {
          const where = await decide();
          if ('reason' in where) return { sent: false, message: `Not printed by itself. ${where.reason}` };
          return receipts.print(where.printerId, lines(current), onStep);
        }, paid);
      void (async () => {
        // Waits for EVERY receipt ahead of it, a tap that started meanwhile included.
        while (inFlight.current) await active.current;
        await print();
      })();
    },
    [receipts, run, decide, lines, onStep],
  );

  return {
    order,
    reprint,
    loading,
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
    printAfterPayment,
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
        disabled={!state.order || state.loading}
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
