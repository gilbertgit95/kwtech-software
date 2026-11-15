import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection, createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { type PrintReportedPrinter, type ReceiptPaperWidth, receiptPreview } from '@kwtech/module-print';
import type { PrinterDriver } from './driver.js';

/**
 * Receipt printers the operating system does not list (#144):
 *
 *   - NETWORK receipt printers named in the settings, reached straight on
 *     their port (9100 on nearly all of them), for a printer nobody installed
 *     in Windows. One installed in Windows is already listed, and prints
 *     through its queue (`WINDOWS_RAW_SCRIPT`).
 *   - VIRTUAL receipt printers, for developing with no printer at all (R3
 *     #147): they "print" by writing the roll as text to a folder, read back
 *     from the bytes exactly as a printer would read them.
 *
 * Wrapped around whichever driver lists the real printers, so pairing,
 * reporting and the relay see them as printers like any other.
 *
 * ⚠ THEY PRINT RECEIPTS ONLY. A PDF sent to one is refused with a reason: it
 * would come out as thousands of lines of garbage on a roll.
 */

/** A network receipt printer from the settings: `Counter 1=192.168.1.50:9100`. */
export interface NetworkReceiptPrinter {
  name: string;
  host: string;
  port: number;
}

/** The port receipt printers listen on for raw bytes ("JetDirect", "RAW 9100"). */
export const RECEIPT_PRINTER_PORT = 9100;

/** How long a network printer may take to accept a receipt before it is called unreachable. */
export const NETWORK_SEND_TIMEOUT_MS = 10_000;

/**
 * `Counter 1=192.168.1.50:9100; Kitchen=192.168.1.51` — names, each an address
 * and an optional port. Throws on a malformed entry, naming it, so a typo in
 * the settings stops the agent at start rather than at the first receipt.
 */
export function parseNetworkPrinters(value: string | undefined): NetworkReceiptPrinter[] {
  if (!value) return [];
  const printers: NetworkReceiptPrinter[] = [];
  for (const entry of value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const match = /^(.+?)=([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/u.exec(entry);
    const name = match?.[1]?.trim();
    const host = match?.[2];
    const port = match?.[3] === undefined ? RECEIPT_PRINTER_PORT : Number(match[3]);
    if (!name || !host || port < 1 || port > 65_535) {
      throw new Error(`"${entry}" is not a network receipt printer. Write it as Name=address or Name=address:port.`);
    }
    if (printers.some((printer) => printer.name === name))
      throw new Error(`Two network printers are called "${name}".`);
    printers.push({ name, host, port });
  }
  return printers;
}

/** The two virtual printers: named so nobody mistakes them for paper. */
export const VIRTUAL_RECEIPT_PRINTERS: readonly { name: string; width: ReceiptPaperWidth }[] = [
  { name: 'Virtual receipt printer, 80 mm (no paper comes out)', width: 80 },
  { name: 'Virtual receipt printer, 58 mm (no paper comes out)', width: 58 },
];

/** Sends bytes to a network printer. The seam the tests replace. */
export type SendToPrinter = (host: string, port: number, bytes: Buffer) => Promise<void>;

/**
 * One TCP connection: write the bytes, close our side, done when the printer
 * closes. ⚠ A printer that never answers is given up on after
 * `NETWORK_SEND_TIMEOUT_MS`, and the job fails with where it tried.
 */
export const sendOverTcp: SendToPrinter = (host, port, bytes) =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(NETWORK_SEND_TIMEOUT_MS);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`The printer at ${host}:${port} did not answer.`));
    });
    socket.once('error', (error) =>
      reject(new Error(`The printer at ${host}:${port} could not be reached — ${error.message}`)),
    );
    socket.once('connect', () => socket.end(bytes));
    socket.once('close', (hadError) => {
      if (!hadError) resolve();
    });
  });

const NO_SETTINGS = { mediaTypes: [], mediaType: null, qualities: [], quality: null };

export function withReceiptPrinters(
  base: PrinterDriver,
  options: {
    network?: readonly NetworkReceiptPrinter[];
    /** A folder for the virtual printers' rolls. Null or left out: no virtual printers. */
    virtualFolder?: string | null;
    send?: SendToPrinter;
    onPrinted?: (line: string) => void;
    now?: () => Date;
  } = {},
): PrinterDriver {
  const network = options.network ?? [];
  const virtual = options.virtualFolder ? VIRTUAL_RECEIPT_PRINTERS : [];
  const send = options.send ?? sendOverTcp;
  const now = options.now ?? (() => new Date());
  const isOurs = (name: string) =>
    network.some((printer) => printer.name === name) || virtual.some((printer) => printer.name === name);
  let printed = 0;

  return {
    async list() {
      const listed = await base.list();
      // A name both the system and the settings use is the settings': the job goes where the person configured it.
      const ours: PrintReportedPrinter[] = [
        ...network.map((printer) => ({
          name: printer.name,
          driver: `Network receipt printer at ${printer.host}:${printer.port}`,
          isDefault: false,
          status: 'ready' as const,
          papers: [],
          settings: NO_SETTINGS,
        })),
        ...virtual.map((printer) => ({
          name: printer.name,
          driver: 'kwtech virtual receipt printer',
          isDefault: false,
          status: 'ready' as const,
          papers: [],
          settings: NO_SETTINGS,
        })),
      ];
      return [...listed.filter((printer) => !isOurs(printer.name)), ...ours];
    },

    async print(request) {
      if (isOurs(request.printerName)) {
        throw new Error(`"${request.printerName}" is a receipt printer: it prints receipts, not documents.`);
      }
      await base.print(request);
    },

    async printRaw(request) {
      const target = network.find((printer) => printer.name === request.printerName);
      if (target) {
        const bytes = await readFile(request.file);
        await send(target.host, target.port, Buffer.concat(Array.from({ length: request.copies }, () => bytes)));
        options.onPrinted?.(
          `Sent a receipt to ${target.host}:${target.port} (${bytes.length} bytes, ${request.copies} copy(ies)).`,
        );
        return;
      }
      const roll = virtual.find((printer) => printer.name === request.printerName);
      if (roll && options.virtualFolder) {
        const bytes = await readFile(request.file);
        const preview = receiptPreview(new Uint8Array(bytes), roll.width);
        await mkdir(options.virtualFolder, { recursive: true });
        printed += 1;
        const stamp = now().toISOString().replace(/[:.]/gu, '-');
        const file = join(options.virtualFolder, `receipt-${stamp}-${printed}-${roll.width}mm.txt`);
        await writeFile(file, Array.from({ length: request.copies }, () => preview).join('\n\n'), 'utf8');
        options.onPrinted?.(
          `Virtual receipt (${roll.width} mm, ${request.copies} copy(ies)) written to ${file}:\n${preview}`,
        );
        return;
      }
      await base.printRaw(request);
    },
  };
}

/**
 * A pretend network receipt printer (R3 #147): listens where a real one does
 * and draws every receipt it is sent, so the network path is tested exactly
 * as a printer would receive it. `print-agent pretend-printer`.
 */
export function startPretendPrinter(
  port: number,
  width: ReceiptPaperWidth,
  onReceipt: (preview: string, bytes: number) => void,
): Promise<Server> {
  const server = createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('end', () => {
      const bytes = Buffer.concat(chunks);
      onReceipt(receiptPreview(new Uint8Array(bytes), width), bytes.length);
      socket.end();
    });
    socket.on('error', () => socket.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}
