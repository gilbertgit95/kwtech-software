'use client';

import type { PrinterChoice, PrinterOutcome, ReceiptPrinterChoice } from '@kwtech/module-kit';
import { usePrinters, useReceiptPrinters, useWorkspaceName } from '@kwtech/module-kit/react';
import {
  BottomSheet,
  BottomSheetRow,
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
import { isOrderSummary, receiptHtml } from '../view/receipt.js';
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
  /**
   * The order is still open: it prints as an ORDER SUMMARY (#163), for a
   * customer to see what they are about to pay — never as a receipt.
   */
  summary: boolean;
  /** Something to print: an order, and for a summary at least one line on it. */
  printable: boolean;
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

  /*
   * Another order, a fresh line under the button. ⚠ Not on null: a reprint's order is null while it reads again.
   * ⚠ ALSO WHEN IT IS PAID (#163): "Sent to Counter 1" for its order summary, left under the receipt's
   * button, read as the receipt having printed already.
   */
  const lastOrderKey = useRef<string | null>(null);
  const orderKey = order ? `${order.id}:${isOrderSummary(order) ? 'summary' : 'receipt'}` : null;
  useEffect(() => {
    if (orderKey === null || orderKey === lastOrderKey.current) return;
    lastOrderKey.current = orderKey;
    setSaid(null);
  }, [orderKey]);

  /*
   * ⚠ NO ORDER IS A SUMMARY TOO: a clear till's button is the summary's, waiting for an item. Said as
   * "Print receipt", it read as a receipt for nothing (found in the browser demo, #163). A reprint's
   * order is null while it reads again, so the label puts `reprint` first.
   */
  const summary = order === null || isOrderSummary(order);
  const printable = order !== null && (!summary || order.lines.length > 0);
  const isCopy = useCallback((current: PosOrderView) => reprint || originals.current.has(current.id), [reprint]);
  const lines = useCallback(
    (current: PosOrderView) =>
      receiptLines(current, {
        timeZone,
        storeName,
        reprintedAt: isCopy(current) ? new Date() : null,
        printedAt: new Date(),
      }),
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
          // ⚠ Not for an order summary (#163): the receipt printed once it is paid would read REPRINT.
          if (outcome?.sent && !isOrderSummary(current)) originals.current.add(current.id);
          setSaid(outcome ? { text: outcome.message, ok: outcome.sent } : null);
        } catch (caught) {
          setSaid({ text: caught instanceof Error ? caught.message : 'Could not print it.', ok: false });
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
    printHtml(
      receiptHtml(order, {
        timeZone,
        storeName,
        reprintedAt: isCopy(order) ? new Date() : null,
        printedAt: new Date(),
      }),
    );
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
    if (!order || !printable || inFlight.current || loading) return;
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
  }, [order, printable, loading, usesPrinters, printInBrowser, run, decide, receipts, lines, onStep]);

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
    summary,
    printable,
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

/** How tall the button is: the height of the buttons it sits beside. */
const HEIGHTS = {
  /** `buttonClass`'s own height: a row of the full screen's buttons (Orders: Refund, Void). */
  md: '',
  /** The till's "Next order". */
  lg: 'h-11 text-base',
  /** A phone's sheet: its "Done" and "Pay" buttons, a thumb's target. */
  phone: 'h-14 text-base',
} as const;

/**
 * "Print receipt ▾": one tap prints where it says, ▾ chooses. Looks only: the
 * hook does the work, so the till's shortcut presses the same button.
 *
 * - `layout="phone"`: the ▾ opens a BOTTOM SHEET of big rows, as every choice
 *   on the phone's POS does (`PhoneDialogs`, 2026-10-29); the desktop keeps
 *   its dropdown. (#154: a desktop menu on a phone felt like the desktop.)
 * - ⚠ THE BUTTON ONLY, no line under it: it sits in a row with its
 *   neighbours at their height. `ReceiptPrintStatus` is the "on Counter 1 ·
 *   Online" line, placed by the caller under the row.
 */
export function ReceiptPrintButton({
  state,
  layout = 'desktop',
  height = layout === 'phone' ? 'phone' : 'md',
  className,
}: {
  state: ReceiptPrintState;
  layout?: 'desktop' | 'phone';
  height?: keyof typeof HEIGHTS;
  className?: string;
}) {
  const label = state.reprint ? 'Reprint receipt' : state.summary ? 'Print order summary' : 'Print receipt';
  const size = HEIGHTS[height];
  const round = layout === 'phone' ? 'rounded-2xl' : '';
  const icon = layout === 'phone' ? 'size-5' : 'size-4';

  if (!state.usesPrinters) {
    return (
      <button
        type="button"
        className={cn(buttonClass('secondary'), size, round, className)}
        disabled={!state.printable || state.loading}
        onClick={state.printInBrowser}
      >
        <Printer aria-hidden="true" className={icon} />
        {label}
      </button>
    );
  }

  const chooser = cn(buttonClass('secondary'), size, round, 'shrink-0 rounded-l-none border-l-0 px-2.5');
  return (
    <div className={cn('flex min-w-0', className)}>
      <button
        type="button"
        className={cn(buttonClass('secondary'), size, round, 'min-w-0 flex-1 rounded-r-none')}
        disabled={!state.printable || state.busy}
        onClick={state.printNow}
      >
        <ReceiptText aria-hidden="true" className={cn(icon, 'shrink-0')} />
        <span className="truncate">{state.busy ? 'Printing…' : label}</span>
      </button>
      {layout === 'phone' ? (
        <>
          <button
            type="button"
            className={chooser}
            disabled={!state.printable || state.busy}
            aria-label="Choose the printer"
            onClick={() => state.setMenuOpen(true)}
          >
            <ChevronDown aria-hidden="true" className={icon} />
          </button>
          <PrinterSheet state={state} />
        </>
      ) : (
        <PrinterDropdown state={state} triggerClassName={chooser} />
      )}
    </div>
  );
}

/**
 * Where the receipt will print, or how it went: the line under the button's
 * row. `aria-live` through `role="status"`, so a screen reader hears it.
 */
export function ReceiptPrintStatus({ state, className }: { state: ReceiptPrintState; className?: string }) {
  if (!state.usesPrinters) return null;
  return (
    <p
      role="status"
      className={cn(
        'min-h-4 truncate text-xs',
        state.said?.ok === false ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {state.said?.text ?? (state.target ? receiptTargetText(state.target) : (state.askReason ?? ''))}
    </p>
  );
}

/** One printer as a choice, in either list: what it is, and why it cannot be chosen now. */
interface ChoiceRow {
  key: string;
  icon: 'receipt' | 'page' | 'browser';
  title: string;
  detail: string | null;
  picked: boolean;
  disabled: boolean;
  onPick: () => void;
}

/** The menu's sections, as data: the dropdown and the sheet show the same choices in the same order. */
function choiceSections(
  state: ReceiptPrintState,
  now: Date,
  /** A phone's row cuts its detail short: the status goes first, where it is never cut. */
  statusFirst = false,
): { label: string | null; rows: ChoiceRow[]; empty?: string }[] {
  return [
    {
      label: 'Receipt printers',
      empty: 'None yet. In the Printers app, choose “Use for receipts…” on a printer.',
      rows: state.receiptPrinters.map((printer) => ({
        key: printer.id,
        icon: 'receipt',
        title: printer.name,
        detail: receiptPrinterDetail(printer, state.timeZone, now, { statusFirst }),
        picked: state.target?.id === printer.id,
        disabled: printer.blocked !== null,
        onPick: () => state.printOn(printer.id),
      })),
    },
    {
      label: state.documentPrinters.length > 0 ? 'Other printers (prints as a page)' : null,
      rows: state.documentPrinters.map((printer) => ({
        key: printer.id,
        icon: 'page',
        title: printer.name,
        detail: printer.blocked ?? `${printer.computer} · a narrow column on its paper`,
        picked: false,
        disabled: printer.blocked !== null,
        onPick: () => state.printAsPage(printer.id),
      })),
    },
    {
      label: null,
      rows: [
        {
          key: 'browser',
          icon: 'browser',
          title: 'Print from this browser',
          detail: null,
          picked: false,
          disabled: false,
          onPick: state.printInBrowser,
        },
      ],
    },
  ];
}

function RowIcon({ icon, className }: { icon: ChoiceRow['icon']; className?: string | undefined }) {
  if (icon === 'receipt') return <ReceiptText aria-hidden="true" className={className} />;
  if (icon === 'page') return <Printer aria-hidden="true" className={className} />;
  return <Globe aria-hidden="true" className={className} />;
}

/** The desktop's ▾: a dropdown under the button. */
function PrinterDropdown({ state, triggerClassName }: { state: ReceiptPrintState; triggerClassName: string }) {
  // Read at each render: "offline since" says today's time as a time, an older one with its date.
  const now = new Date();
  // Inside a native <dialog>, the menu must open inside it, or it opens behind it.
  const anchor = useRef<HTMLSpanElement>(null);
  const dialog = state.menuOpen ? (anchor.current?.closest('dialog') ?? null) : null;
  return (
    <DropdownMenu open={state.menuOpen} onOpenChange={state.setMenuOpen}>
      <span ref={anchor} className="contents" />
      <DropdownMenuTrigger
        className={triggerClassName}
        disabled={!state.printable || state.busy}
        aria-label="Choose the printer"
      >
        <ChevronDown aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        container={dialog}
        // In a dialog, kept inside it (it clips what passes its edge), scrolling when it is taller.
        {...(dialog ? { collisionBoundary: dialog, collisionPadding: 8 } : {})}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        {state.askReason ? (
          <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
            {state.askReason}
          </p>
        ) : null}
        {choiceSections(state, now).map((section, index) =>
          section.rows.length === 0 && !section.empty ? null : (
            <div key={section.label ?? `section-${index}`}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              {section.label ? <DropdownMenuLabel>{section.label}</DropdownMenuLabel> : null}
              {section.rows.length === 0 && section.empty ? (
                <p className="px-2 pb-1.5 text-xs text-muted-foreground">{section.empty}</p>
              ) : null}
              {section.rows.map((row) => (
                <DropdownMenuItem
                  key={row.key}
                  disabled={row.disabled}
                  onSelect={row.onPick}
                  className={row.detail ? 'items-start' : undefined}
                >
                  <RowIcon icon={row.icon} className={row.detail ? 'mt-0.5' : undefined} />
                  <span className="min-w-0">
                    <span className={cn('block truncate', row.icon === 'receipt' ? 'font-medium' : null)}>
                      {row.title}
                      {row.picked ? ' ✓' : ''}
                    </span>
                    {row.detail ? <span className="block text-xs text-muted-foreground">{row.detail}</span> : null}
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The phone's ▾: a bottom sheet of thumb-sized rows (#154), the same choices
 * as the desktop's dropdown. Picking one closes it and prints.
 */
function PrinterSheet({ state }: { state: ReceiptPrintState }) {
  const now = new Date();
  const pick = (row: ChoiceRow) => {
    state.setMenuOpen(false);
    row.onPick();
  };
  return (
    <BottomSheet
      open={state.menuOpen}
      onClose={() => state.setMenuOpen(false)}
      title={
        state.reprint
          ? 'Reprint the receipt on…'
          : state.summary
            ? 'Print the order summary on…'
            : 'Print the receipt on…'
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {state.askReason ? (
          <p role="status" className="rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">
            {state.askReason}
          </p>
        ) : null}
        {choiceSections(state, now, true).map((section, index) =>
          section.rows.length === 0 && !section.empty ? null : (
            <section key={section.label ?? `section-${index}`} className="flex flex-col gap-2">
              {section.label ? (
                <h3 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {section.label}
                </h3>
              ) : null}
              {section.rows.length === 0 && section.empty ? (
                <p className="px-1 text-sm text-muted-foreground">{section.empty}</p>
              ) : null}
              {section.rows.map((row) => (
                <BottomSheetRow
                  key={row.key}
                  icon={<RowIcon icon={row.icon} className="size-5" />}
                  label={row.picked ? `${row.title} ✓` : row.title}
                  detail={row.detail}
                  current={row.picked}
                  disabled={row.disabled}
                  onClick={() => pick(row)}
                />
              ))}
            </section>
          ),
        )}
      </div>
    </BottomSheet>
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
