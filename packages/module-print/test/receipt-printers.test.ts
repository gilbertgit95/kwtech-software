import { DEFAULT_RECEIPT_PROFILE, receiptPlainText } from '../src/domain/receipt.js';
import { receiptPagePdf } from '../src/domain/receipt-page.js';
import {
  checkJobForPrinter,
  type PrintReceiptSettings,
  pickReceiptPrinter,
  prepareReceiptSettings,
  type ReceiptPickCandidate,
  receiptPrinterName,
  receiptProfileOf,
  testReceiptLines,
} from '../src/domain/receipt-printers.js';
import { receiptKindText } from '../src/react/view.js';

const SETTINGS: PrintReceiptSettings = { label: 'Counter 1', paperWidth: 80, cutter: true, drawer: true, qr: true };

describe('a receipt printer’s settings (#144, R4)', () => {
  it('keep a trimmed name, or none, a width of 58 or 80, and three switches', () => {
    expect(prepareReceiptSettings({ ...SETTINGS, label: '  Kitchen ' })).toEqual({ ...SETTINGS, label: 'Kitchen' });
    expect(prepareReceiptSettings({ ...SETTINGS, label: '   ' })).toMatchObject({ label: null });
    expect(prepareReceiptSettings({ ...SETTINGS, label: undefined })).toMatchObject({ label: null });
    expect(prepareReceiptSettings({ ...SETTINGS, paperWidth: 57 })).toEqual({ refused: 'invalid_receipt_settings' });
    expect(prepareReceiptSettings({ ...SETTINGS, label: 7 })).toEqual({ refused: 'invalid_receipt_settings' });
    expect(prepareReceiptSettings({ ...SETTINGS, qr: 1 })).toEqual({ refused: 'invalid_receipt_settings' });
  });

  it('are the builder’s profile, and the name a person sees', () => {
    expect(receiptProfileOf(SETTINGS)).toEqual({ paperWidth: 80, cutter: true, drawer: true, qr: true });
    expect(receiptPrinterName({ name: 'XP-80C', receipt: SETTINGS })).toBe('Counter 1');
    expect(receiptPrinterName({ name: 'XP-80C', receipt: null })).toBe('XP-80C');
    expect(receiptKindText(SETTINGS)).toBe('Receipt · 80 mm · cuts · drawer');
    expect(receiptKindText({ paperWidth: 58, cutter: false, drawer: false })).toBe('Receipt · 58 mm');
  });
});

describe('one kind of job per kind of printer', () => {
  it('⚠ sends a receipt only to a receipt printer, and a document never to one', () => {
    expect(checkJobForPrinter('escpos', true)).toBeNull();
    expect(checkJobForPrinter('pdf', false)).toBeNull();
    expect(checkJobForPrinter('escpos', false)).toBe('not_a_receipt_printer');
    expect(checkJobForPrinter('pdf', true)).toBe('receipt_printer_only');
  });
});

describe('the Test receipt', () => {
  const printed = (receipt: PrintReceiptSettings) =>
    receiptPlainText(testReceiptLines({ name: 'XP-80C', receipt }, '16 Nov 2026, 9:05 AM'), receiptProfileOf(receipt), {
      markers: true,
    });

  it('has a ruler of digits exactly one line wide, which a wrong width would wrap', () => {
    expect(printed(SETTINGS).split('\n')).toContain('123456789012345678901234567890123456789012345678');
    expect(printed({ ...SETTINGS, paperWidth: 58 }).split('\n')).toContain('12345678901234567890123456789012');
  });

  it('tests the QR code, the drawer and the cut only where the printer has them', () => {
    const full = printed(SETTINGS);
    expect(full).toContain('[QR: kwtech]');
    expect(full).toContain('[drawer opened]');
    expect(full).toContain('The paper is cut below.');
    const plain = printed({ ...SETTINGS, qr: false, drawer: false, cutter: false });
    expect(plain).not.toContain('QR');
    expect(plain).not.toContain('drawer');
    expect(plain).toContain('No cutter: tear the paper here.');
  });

  it('names the printer by its place', () => {
    expect(printed(SETTINGS)).toContain('Counter 1');
    expect(DEFAULT_RECEIPT_PROFILE.paperWidth).toBe(80);
  });
});

describe('pickReceiptPrinter (#144, R5)', () => {
  const printer = (id: string, over: Partial<ReceiptPickCandidate> = {}): ReceiptPickCandidate => ({
    id,
    name: `Counter ${id}`,
    computer: 'Front desk PC',
    isDefault: false,
    blocked: null,
    ...over,
  });
  const OFF = 'That computer is offline.';

  it('goes to this device’s choice first, then the default, then the only one online', () => {
    const printers = [printer('1', { isDefault: true }), printer('2')];
    expect(pickReceiptPrinter(printers, '2')).toEqual({ kind: 'printer', printerId: '2', because: 'device' });
    expect(pickReceiptPrinter(printers, null)).toEqual({ kind: 'printer', printerId: '1', because: 'default' });
    expect(pickReceiptPrinter([printer('1'), printer('2', { blocked: OFF })], null)).toEqual({
      kind: 'printer',
      printerId: '1',
      because: 'only',
    });
  });

  it('⚠ never swaps an offline choice or default for another printer: it asks, naming it and its computer', () => {
    const asked = pickReceiptPrinter([printer('1', { blocked: OFF }), printer('2')], '1');
    expect(asked).toMatchObject({
      kind: 'ask',
      reason: expect.stringMatching(/Counter 1.*this device.*Front desk PC/u),
    });
    const byDefault = pickReceiptPrinter([printer('1', { blocked: OFF, isDefault: true }), printer('2')], null);
    expect(byDefault).toMatchObject({ kind: 'ask', reason: expect.stringMatching(/workspace/u) });
  });

  it('ignores a device choice that is no longer a receipt printer', () => {
    expect(pickReceiptPrinter([printer('2')], 'gone')).toMatchObject({ printerId: '2', because: 'only' });
  });

  it('asks, saying why, when there are none, none online, or several and no choice', () => {
    expect(pickReceiptPrinter([], null)).toMatchObject({ kind: 'ask', reason: expect.stringMatching(/no receipt/u) });
    expect(pickReceiptPrinter([printer('1', { blocked: OFF })], null)).toMatchObject({
      kind: 'ask',
      reason: expect.stringMatching(/No receipt printer is online/u),
    });
    expect(pickReceiptPrinter([printer('1'), printer('2')], null)).toMatchObject({
      kind: 'ask',
      reason: expect.stringMatching(/Choose/u),
    });
  });
});

describe('receiptPagePdf (#144, R5)', () => {
  const A4 = { width: 21000, height: 29700 };
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

  it('writes the roll’s text in Courier on the printer’s paper, a QR code as its text, no cut', () => {
    const pdf = text(
      receiptPagePdf(
        [
          { kind: 'text', text: 'Kape Tayo (Main)', align: 'center' },
          { kind: 'pair', left: 'Iced coffee x2', right: '₱180.00' },
          { kind: 'qr', data: 'https://example.test/r/1' },
          { kind: 'cut' },
        ],
        A4,
      ),
    );
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/BaseFont /Courier');
    expect(pdf).toContain('/MediaBox [0 0 595.276 841.89]');
    // Parentheses escaped; the peso sign folded to text the font can print, as on the roll.
    expect(pdf).toContain('Kape Tayo \\(Main\\)');
    expect(pdf).toMatch(/Iced coffee x2 +PHP180\.00/u);
    expect(pdf).toContain('https://example.test/r/1');
    expect(pdf).toContain('/Count 1');
  });

  it('runs a long receipt onto a second sheet rather than shrinking it', () => {
    const lines = Array.from({ length: 120 }, (_, index) => ({ kind: 'text' as const, text: `Line ${index}` }));
    expect(text(receiptPagePdf(lines, A4))).toContain('/Count 2');
  });

  it('keeps every offset in the cross-reference table exact', () => {
    const bytes = receiptPagePdf([{ kind: 'text', text: 'Hello' }], A4);
    const pdf = text(bytes);
    const table = /xref\n0 (\d+)\n0000000000 65535 f \n((?:\d{10} 00000 n \n)+)/u.exec(pdf);
    for (const [index, row] of (table?.[2] ?? '').trim().split('\n').entries()) {
      expect(pdf.slice(Number(row.slice(0, 10)))).toMatch(new RegExp(`^${index + 1} 0 obj`, 'u'));
    }
    expect(Number(table?.[1])).toBeGreaterThan(4);
  });
});
