import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_RECEIPT_PROFILE, encodeReceipt } from '@kwtech/module-print';
import { createFakeDriver, FAKE_PRINTERS } from '../src/printers/fake.js';
import {
  parseNetworkPrinters,
  RECEIPT_PRINTER_PORT,
  sendOverTcp,
  startPretendPrinter,
  VIRTUAL_RECEIPT_PRINTERS,
  withReceiptPrinters,
} from '../src/printers/receipt-printers.js';

const temp = mkdtempSync(join(tmpdir(), 'print-agent-receipts-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const RECEIPT = Buffer.from(
  encodeReceipt(
    [
      { kind: 'text', text: 'Kwtech Cafe', align: 'center', bold: true },
      { kind: 'pair', left: 'Iced coffee', right: 'PHP90.00' },
      { kind: 'cut' },
    ],
    DEFAULT_RECEIPT_PROFILE,
  ),
);

function receiptFile(name: string): string {
  const file = join(temp, name);
  writeFileSync(file, RECEIPT);
  return file;
}

describe('network receipt printers in the settings', () => {
  it('reads names, addresses and ports, port 9100 when none is given', () => {
    expect(parseNetworkPrinters('Counter 1=192.168.1.50:9101; Kitchen=printer.local')).toEqual([
      { name: 'Counter 1', host: '192.168.1.50', port: 9101 },
      { name: 'Kitchen', host: 'printer.local', port: RECEIPT_PRINTER_PORT },
    ]);
    expect(parseNetworkPrinters(undefined)).toEqual([]);
  });

  it('refuses a malformed entry or a name used twice, naming it', () => {
    expect(() => parseNetworkPrinters('Counter 1')).toThrow('"Counter 1" is not a network receipt printer');
    expect(() => parseNetworkPrinters('A=1.2.3.4:99999')).toThrow('is not a network receipt printer');
    expect(() => parseNetworkPrinters('A=1.2.3.4; A=1.2.3.5')).toThrow('Two network printers are called "A"');
  });
});

describe('the receipt printers around a driver', () => {
  const network = [{ name: 'Counter 1', host: '10.0.0.5', port: 9100 }];

  it('lists the network and virtual printers after the system’s, with no papers', async () => {
    const driver = withReceiptPrinters(createFakeDriver(), { network, virtualFolder: temp });
    const names = (await driver.list()).map((printer) => printer.name);
    expect(names).toEqual([
      ...FAKE_PRINTERS.map((printer) => printer.name),
      'Counter 1',
      ...VIRTUAL_RECEIPT_PRINTERS.map((printer) => printer.name),
    ]);
    const counter = (await driver.list()).find((printer) => printer.name === 'Counter 1');
    expect(counter).toMatchObject({ driver: 'Network receipt printer at 10.0.0.5:9100', papers: [] });
  });

  it('lists no virtual printer unless a folder is set', async () => {
    const names = (await withReceiptPrinters(createFakeDriver()).list()).map((printer) => printer.name);
    expect(names.some((name) => name.startsWith('Virtual'))).toBe(false);
  });

  it('⚠ refuses a document on a receipt printer, with the reason', async () => {
    const driver = withReceiptPrinters(createFakeDriver(), { network });
    await expect(
      driver.print({ file: receiptFile('doc.pdf'), printerName: 'Counter 1', paper: null, copies: 1 }),
    ).rejects.toThrow('"Counter 1" is a receipt printer: it prints receipts, not documents.');
  });

  it('sends a network printer the bytes once per copy', async () => {
    const sent: Array<{ host: string; port: number; bytes: Buffer }> = [];
    const driver = withReceiptPrinters(createFakeDriver(), {
      network,
      send: async (host, port, bytes) => {
        sent.push({ host, port, bytes });
      },
    });
    await driver.printRaw({ file: receiptFile('r1.bin'), printerName: 'Counter 1', copies: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ host: '10.0.0.5', port: 9100 });
    expect(sent[0]?.bytes.equals(Buffer.concat([RECEIPT, RECEIPT]))).toBe(true);
  });

  it('writes a virtual printer’s roll to its folder, read back from the bytes', async () => {
    const folder = join(temp, 'rolls');
    const lines: string[] = [];
    const driver = withReceiptPrinters(createFakeDriver(), {
      virtualFolder: folder,
      onPrinted: (line) => lines.push(line),
      now: () => new Date('2026-11-16T01:00:00.000Z'),
    });
    const name = VIRTUAL_RECEIPT_PRINTERS[0]?.name ?? '';
    await driver.printRaw({ file: receiptFile('r2.bin'), printerName: name, copies: 1 });
    const [roll] = readdirSync(folder);
    expect(roll).toMatch(/^receipt-2026-11-16T01-00-00-000Z-1-80mm\.txt$/u);
    const text = readFileSync(join(folder, roll ?? ''), 'utf8');
    expect(text).toContain('Kwtech Cafe');
    expect(text).toContain('Iced coffee');
    expect(text).toContain('PHP90.00');
    expect(text).toContain('✂');
    expect(lines[0]).toContain('Virtual receipt (80 mm, 1 copy(ies))');
  });

  it('passes any other printer’s receipt to the system driver', async () => {
    const lines: string[] = [];
    const driver = withReceiptPrinters(createFakeDriver([], { onPrinted: (line) => lines.push(line) }), { network });
    await driver.printRaw({ file: receiptFile('r3.bin'), printerName: FAKE_PRINTERS[0]?.name ?? '', copies: 1 });
    expect(lines[0]).toContain(`Fake raw print on "${FAKE_PRINTERS[0]?.name}": ${RECEIPT.length} bytes`);
  });
});

describe('the pretend network printer', () => {
  it('draws a receipt sent to it over TCP, as a printer on port 9100 would receive it', async () => {
    const received: string[] = [];
    let arrived: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const server = await startPretendPrinter(0, 80, (preview) => {
      received.push(preview);
      arrived();
    });
    try {
      const { port } = server.address() as AddressInfo;
      await sendOverTcp('127.0.0.1', port, RECEIPT);
      await done;
      expect(received[0]).toContain('Kwtech Cafe');
      expect(received[0]).toContain('PHP90.00');
    } finally {
      server.close();
    }
  });

  it('says where it tried when nothing listens', async () => {
    const server = await startPretendPrinter(0, 80, () => {});
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(sendOverTcp('127.0.0.1', port, RECEIPT)).rejects.toThrow(
      `The printer at 127.0.0.1:${port} could not be reached`,
    );
  });
});
