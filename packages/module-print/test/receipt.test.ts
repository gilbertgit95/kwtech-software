import {
  checkReceipt,
  DEFAULT_RECEIPT_PROFILE,
  encodeReceipt,
  layoutReceipt,
  placeOnRoll,
  RECEIPT_COLUMNS,
  RECEIPT_LINES_MAX,
  type ReceiptLine,
  type ReceiptPrinterProfile,
  receiptPlainText,
  toReceiptText,
  wrapReceiptText,
} from '../src/domain/receipt.js';

const P80 = DEFAULT_RECEIPT_PROFILE;
const P58: ReceiptPrinterProfile = { paperWidth: 58, cutter: false, drawer: false, qr: false };

/** Bytes as hex, for comparing against the ESC/POS manual. */
const hex = (bytes: Uint8Array | number[]): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
/** Whether `needle` occurs in `bytes` in order. */
function contains(bytes: Uint8Array, needle: number[]): boolean {
  return hex(bytes).includes(hex(needle));
}

const SALE: ReceiptLine[] = [
  { kind: 'text', text: 'Kwtech Café', align: 'center', bold: true, size: 'double' },
  { kind: 'text', text: 'Sale #1042 · 16 Nov 2026, 9:05 AM', align: 'center' },
  { kind: 'divider' },
  { kind: 'pair', left: 'Iced coffee x2', right: '₱180.00' },
  { kind: 'pair', left: 'Ensaymada with extra cheese and butter, large', right: '₱95.00' },
  { kind: 'divider', char: '=' },
  { kind: 'pair', left: 'TOTAL', right: '₱275.00', bold: true },
  { kind: 'feed', lines: 1 },
  { kind: 'qr', data: 'https://example.test/r/1042' },
  { kind: 'text', text: 'Thank you!', align: 'center' },
  { kind: 'drawer' },
  { kind: 'cut' },
];

describe('the printer’s characters', () => {
  it('prints ₱ as PHP, drops accents, and never sends a raw control byte', () => {
    expect(toReceiptText('₱180.00')).toBe('PHP180.00');
    expect(toReceiptText('Café Niño — “best”…')).toBe('Cafe Nino - "best"...');
    expect(toReceiptText('a\tb\u0007c😀')).toBe('a b?c?');
  });
});

describe('the layout', () => {
  it('has 48 columns at 80 mm and 32 at 58 mm', () => {
    expect(RECEIPT_COLUMNS).toEqual({ 58: 32, 80: 48 });
    const text = receiptPlainText([{ kind: 'divider' }], P58);
    expect(text).toBe('-'.repeat(32));
  });

  it('wraps on words, and breaks a word longer than the line', () => {
    expect(wrapReceiptText('one two three', 8)).toEqual(['one two', 'three']);
    expect(wrapReceiptText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapReceiptText('', 10)).toEqual(['']);
  });

  it('puts a price flush right on the first line, and wraps the name under it', () => {
    const rows = receiptPlainText(
      [{ kind: 'pair', left: 'Ensaymada with extra cheese and butter, large', right: 'PHP95.00' }],
      P58,
    ).split('\n');
    expect(rows[0]).toHaveLength(32);
    expect(rows[0]?.endsWith(' PHP95.00')).toBe(true);
    // The rest of the name uses the whole width, not only the room beside the price.
    expect(rows.slice(1).every((row) => row.length <= 32)).toBe(true);
    const name = rows.map((row, index) => (index === 0 ? row.replace(/ PHP95\.00$/u, '') : row)).join(' ');
    expect(name.replace(/\s+/gu, ' ').trim()).toBe('Ensaymada with extra cheese and butter, large');
  });

  it('fits half as many characters on a double-size line', () => {
    const rows = layoutReceipt([{ kind: 'text', text: 'x'.repeat(30), size: 'double' }], P80);
    expect(rows).toEqual([
      { kind: 'text', text: 'x'.repeat(24), align: 'left', bold: false, double: true },
      { kind: 'text', text: 'x'.repeat(6), align: 'left', bold: false, double: true },
    ]);
  });

  it('reads like the printed roll, with markers for what paper cannot show', () => {
    const text = receiptPlainText(SALE, { ...P80, drawer: true }, { markers: true });
    expect(text).toContain('PHP275.00');
    expect(text).toContain('[QR: https://example.test/r/1042]');
    expect(text).toContain('[drawer opened]');
    expect(text.split('\n').at(-1)?.startsWith('✂')).toBe(true);
    expect(text.split('\n').every((row) => row.length <= 48)).toBe(true);
  });
});

describe('the ESC/POS bytes', () => {
  const bytes = encodeReceipt(SALE, { ...P80, drawer: true });

  it('resets first and leaves the printer aligned left', () => {
    expect(hex(bytes.slice(0, 2))).toBe('1b 40');
    expect(hex(bytes.slice(-3))).toBe('1b 61 00');
  });

  it('switches bold and double size on for a row and off after it', () => {
    expect(
      contains(bytes, [
        0x1b,
        0x61,
        1,
        0x1b,
        0x45,
        1,
        0x1d,
        0x21,
        0x11,
        ...Buffer.from('Kwtech Cafe'),
        0x0a,
        0x1d,
        0x21,
        0,
        0x1b,
        0x45,
        0,
      ]),
    ).toBe(true);
  });

  it('prints a QR code with the GS ( k sequence, centred', () => {
    expect(contains(bytes, [0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])).toBe(true);
    const data = 'https://example.test/r/1042';
    expect(contains(bytes, [0x1d, 0x28, 0x6b, data.length + 3, 0, 0x31, 0x50, 0x30, ...Buffer.from(data)])).toBe(true);
    expect(contains(bytes, [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30])).toBe(true);
  });

  it('pulses the drawer and feeds past the cutter before cutting', () => {
    expect(contains(bytes, [0x1b, 0x70, 0x00, 0x19, 0xfa])).toBe(true);
    expect(contains(bytes, [0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0])).toBe(true);
  });

  it('only ever sends printable text between commands', () => {
    // No byte of the receipt's text is a control byte: ₱ and the accents are already replaced.
    expect(contains(bytes, [...Buffer.from('PHP180.00'), 0x0a])).toBe(true);
    expect([...bytes].some((byte) => byte > 0x7e && byte !== 0xfa)).toBe(false);
  });

  it('degrades on a printer without a cutter, a drawer or QR codes', () => {
    const plain = encodeReceipt(SALE, P58);
    expect(contains(plain, [0x1d, 0x56])).toBe(false);
    expect(contains(plain, [0x1b, 0x70])).toBe(false);
    expect(contains(plain, [0x1d, 0x28, 0x6b])).toBe(false);
    // The QR's link is printed as text instead, and the paper still feeds out to tear.
    expect(contains(plain, [...Buffer.from('https://example.test/r/1042')])).toBe(true);
    expect(contains(plain, [0x1b, 0x64, 4])).toBe(true);
  });
});

describe('checking a receipt', () => {
  it('refuses an empty receipt or one far too long', () => {
    expect(checkReceipt([])).toBe('receipt_empty');
    expect(checkReceipt(Array.from({ length: RECEIPT_LINES_MAX + 1 }, () => ({ kind: 'feed' as const })))).toBe(
      'receipt_too_long',
    );
    expect(checkReceipt(SALE)).toBeNull();
  });
});

describe('what the review found (#150)', () => {
  it('⚠ never loops when a price leaves no room for the name', () => {
    const right = 'x'.repeat(31);
    const rows = receiptPlainText([{ kind: 'pair', left: 'Coffee', right }], P58).split('\n');
    expect(rows).toEqual(['Coffee', right.padStart(32)]);
    expect(wrapReceiptText('abc', 0)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a line break as a new row, never as "?"', () => {
    expect(toReceiptText('Thank you!\r\nCome again')).toBe('Thank you!\nCome again');
    const rows = receiptPlainText([{ kind: 'text', text: 'Thank you!\nCome again' }], P58).split('\n');
    expect(rows).toEqual(['Thank you!', 'Come again']);
  });

  it('⚠ never cuts a price wider than the line: it wraps, flush right', () => {
    const right = 'PHP 1,234,567.89 (incl. 12% VAT)';
    const rows = receiptPlainText([{ kind: 'pair', left: 'TOTAL', right }], P58).split('\n');
    expect(rows[0]).toBe('TOTAL');
    expect(
      rows
        .slice(1)
        .map((row) => row.trim())
        .join(' '),
    ).toBe(right);
    expect(rows.every((row) => row.length <= 32)).toBe(true);
  });

  it('wraps the rest of a long name across the whole width', () => {
    const rows = receiptPlainText(
      [{ kind: 'pair', left: 'Ensaymada with extra cheese and butter, large size', right: 'PHP 12,345.00' }],
      P58,
    ).split('\n');
    expect(rows[0]?.endsWith(' PHP 12,345.00')).toBe(true);
    expect(rows.slice(1).some((row) => row.length > 18)).toBe(true);
  });

  it('wraps a QR code’s text to the paper in the plain roll', () => {
    const data = `https://example.test/${'r'.repeat(100)}`;
    const text = receiptPlainText([{ kind: 'qr', data }], P58, { markers: true });
    expect(text.split('\n').every((row) => row.length <= 32)).toBe(true);
  });

  it('places a double-size row where it prints: each character takes two columns', () => {
    expect(placeOnRoll('TOTAL 275', 'right', 48, true)).toBe(`${' '.repeat(30)}TOTAL 275`);
    expect(placeOnRoll('TOTAL 275', 'right', 48)).toBe(`${' '.repeat(39)}TOTAL 275`);
    expect(placeOnRoll('x'.repeat(24), 'center', 48, true)).toBe('x'.repeat(24));
  });

  it('folds compatibility characters as the POS search does, and drops a lone accent mark', () => {
    expect(toReceiptText('１８０ ﬁ ½ ²')).toBe('180 fi 1/2 2');
    expect(toReceiptText('PHP 1\u202f234')).toBe('PHP 1 234');
    expect(toReceiptText('q\u0303 n\u0331')).toBe('q n');
  });

  it('⚠ refuses to lay out a receipt past the limits, whoever forgot to check', () => {
    expect(() => encodeReceipt([], P80)).toThrow('receipt_empty');
    expect(() => encodeReceipt([{ kind: 'text', text: 'x'.repeat(3000) }], P80)).toThrow('receipt_too_long');
  });
});
