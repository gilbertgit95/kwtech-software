import { DEFAULT_RECEIPT_PROFILE, receiptPlainText } from '../src/domain/receipt.js';
import {
  checkJobForPrinter,
  type PrintReceiptSettings,
  prepareReceiptSettings,
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
