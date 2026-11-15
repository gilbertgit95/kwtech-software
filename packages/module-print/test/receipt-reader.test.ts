import { DEFAULT_RECEIPT_PROFILE, encodeReceipt, type ReceiptLine, receiptPlainText } from '../src/domain/receipt.js';
import { readReceiptBytes, receiptPreview } from '../src/domain/receipt-reader.js';

const SALE: ReceiptLine[] = [
  { kind: 'text', text: 'Kwtech Café', align: 'center', bold: true, size: 'double' },
  { kind: 'divider' },
  { kind: 'pair', left: 'Ensaymada with extra cheese and butter, large', right: '₱95.00' },
  { kind: 'pair', left: 'TOTAL', right: '₱95.00', bold: true },
  { kind: 'qr', data: 'https://example.test/r/1042' },
  { kind: 'text', text: 'Thank you!', align: 'right' },
  { kind: 'drawer' },
  { kind: 'cut' },
];
const FULL = { ...DEFAULT_RECEIPT_PROFILE, drawer: true };

/** The roll without its blank lines: the encoder feeds past the cutter, which the plain layout does not show. */
function withoutBlanks(text: string): string {
  return text
    .split('\n')
    .filter((row) => row.trim() !== '')
    .join('\n');
}

describe('reading ESC/POS back', () => {
  it('gives back the roll the builder laid out, line for line', () => {
    const bytes = encodeReceipt(SALE, FULL);
    expect(withoutBlanks(receiptPreview(bytes, 80))).toBe(
      withoutBlanks(receiptPlainText(SALE, FULL, { markers: true })),
    );
  });

  it('keeps each line’s style', () => {
    const marks = readReceiptBytes(encodeReceipt(SALE, FULL));
    expect(marks[0]).toEqual({ kind: 'line', text: 'Kwtech Cafe', align: 'center', bold: true, double: true });
    expect(marks.find((mark) => mark.kind === 'line' && mark.text.startsWith('TOTAL'))).toMatchObject({
      bold: true,
      double: false,
    });
    expect(marks.filter((mark) => mark.kind === 'cut')).toEqual([{ kind: 'cut', partial: true }]);
    expect(marks.filter((mark) => mark.kind === 'qr')).toEqual([{ kind: 'qr', data: 'https://example.test/r/1042' }]);
    expect(marks.filter((mark) => mark.kind === 'drawer')).toHaveLength(1);
  });

  it('names a command it does not know instead of dropping it', () => {
    // ESC t 16 (choose a code page): the builder never sends it, so a test roll should show it.
    expect(readReceiptBytes(Uint8Array.from([0x1b, 0x74, 0x10, 0x41, 0x0a]))).toEqual([
      { kind: 'unknown', command: '1B 74' },
      { kind: 'unknown', command: '10' },
      { kind: 'line', text: 'A', align: 'left', bold: false, double: false },
    ]);
    expect(receiptPreview(Uint8Array.from([0x07, 0x41, 0x0a]), 58)).toBe('[07]\nA');
  });

  it('does not throw on a command cut short', () => {
    expect(() => readReceiptBytes(Uint8Array.from([0x1d, 0x28, 0x6b, 0x10]))).not.toThrow();
    expect(readReceiptBytes(Uint8Array.from([0x1b]))).toEqual([{ kind: 'unknown', command: '1B' }]);
  });
});
