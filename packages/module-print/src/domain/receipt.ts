/**
 * Receipts for thermal printers (#144, R1 #145): a receipt as LINES, laid out
 * for a paper width, and turned into ESC/POS — the command language almost
 * every receipt printer speaks (Epson's, followed by Xprinter, Rongta, HPRT and
 * the unbranded 58/80 mm models).
 *
 * Pure: the POS builds the lines, the server relays the bytes, the print agent
 * sends them as they are, and its virtual printer reads them back (R3). One
 * copy of the layout, so the printed roll, the preview and the narrow-page
 * fallback can never disagree.
 *
 * ⚠ ONLY THE COMMON COMMANDS by default — reset, align, bold, double size,
 * feed, cut, the drawer. Where cheap printers differ (QR codes, character
 * sets), the printer's profile says what it has, and a receipt degrades
 * rather than sending a command the printer would print as garbage.
 */

/** Where a line sits across the paper. */
export type ReceiptAlign = 'left' | 'center' | 'right';

/** One thing on a receipt. The POS (and anything later) describes a receipt as these, never as bytes. */
export type ReceiptLine =
  | {
      kind: 'text';
      text: string;
      align?: ReceiptAlign;
      bold?: boolean;
      /** Double width and height: a total, the shop's name. Half as many characters fit. */
      size?: 'normal' | 'double';
    }
  /** "Iced coffee x2 …… PHP 180.00": the left side wraps, the right side never does. */
  | { kind: 'pair'; left: string; right: string; bold?: boolean }
  /** A full line of one character: "------". */
  | { kind: 'divider'; char?: '-' | '=' }
  /** Blank lines. */
  | { kind: 'feed'; lines?: number }
  /** A QR code, centred. On a printer without QR support its `data` is printed as text instead. */
  | { kind: 'qr'; data: string }
  /** Cut the paper here (after feeding it past the cutter). Ignored by a printer with no cutter. */
  | { kind: 'cut' }
  /** Open the cash drawer attached to the printer. Ignored when none is attached. */
  | { kind: 'drawer' };

/** The two roll widths receipt printers take. */
export const RECEIPT_PAPER_WIDTHS = [58, 80] as const;
export type ReceiptPaperWidth = (typeof RECEIPT_PAPER_WIDTHS)[number];

/**
 * Characters per line in the printer's normal font (font A, 12×24 dots): 48 on
 * an 80 mm roll, 32 on a 58 mm one. Every ESC/POS printer of those widths
 * agrees on these, which is why the layout is in characters, not millimetres.
 */
export const RECEIPT_COLUMNS: Readonly<Record<ReceiptPaperWidth, number>> = { 58: 32, 80: 48 };

/** What one receipt printer can do. Set per printer in the Printers app (R4). */
export interface ReceiptPrinterProfile {
  paperWidth: ReceiptPaperWidth;
  /** Has an auto-cutter. Without one, a `cut` only feeds the paper out to tear. */
  cutter: boolean;
  /** A cash drawer is plugged into it. Without one, `drawer` sends nothing. */
  drawer: boolean;
  /** Prints QR codes (`GS ( k`). Most printers made since about 2015 do; some cheap ones do not. */
  qr: boolean;
}

/** An 80 mm printer with a cutter and no drawer: the commonest counter printer, and what a test assumes. */
export const DEFAULT_RECEIPT_PROFILE: ReceiptPrinterProfile = { paperWidth: 80, cutter: true, drawer: false, qr: true };

/** The most lines one receipt may have: a long sale is a few hundred; past this it is a mistake, not a receipt. */
export const RECEIPT_LINES_MAX = 1000;

/** The longest text one line may carry before wrapping: the same reasoning. */
export const RECEIPT_TEXT_MAX = 2000;

/** The longest QR payload printed as a code: QR model 2 holds more, but a receipt's code is a link or a number. */
export const RECEIPT_QR_MAX = 300;

export type ReceiptRefusal = 'receipt_empty' | 'receipt_too_long';

/** Why these lines cannot be printed as a receipt, or null. */
export function checkReceipt(lines: readonly ReceiptLine[]): ReceiptRefusal | null {
  if (lines.length === 0) return 'receipt_empty';
  if (lines.length > RECEIPT_LINES_MAX) return 'receipt_too_long';
  for (const line of lines) {
    switch (line.kind) {
      case 'text':
        if (line.text.length > RECEIPT_TEXT_MAX) return 'receipt_too_long';
        break;
      case 'pair':
        if (line.left.length + line.right.length > RECEIPT_TEXT_MAX) return 'receipt_too_long';
        break;
      case 'qr':
        if (line.data.length > RECEIPT_TEXT_MAX) return 'receipt_too_long';
        break;
      case 'divider':
      case 'feed':
      case 'cut':
      case 'drawer':
        break;
    }
  }
  return null;
}

// ── characters ──────────────────────────────────────────────────────────────

/**
 * Symbols a printer's built-in character set lacks, as words it can print.
 * ⚠ "₱" FIRST: most receipt printers have no peso sign in any code page, and
 * a raw "₱" prints as two or three garbage characters.
 */
const SYMBOL_WORDS: Readonly<Record<string, string>> = {
  '₱': 'PHP',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '“': '"',
  '”': '"',
  '„': '"',
  '‘': "'",
  '’': "'",
  '–': '-',
  '—': '-',
  '…': '...',
  '•': '*',
  '·': '.',
  '×': 'x',
  ' ': ' ',
};

/**
 * Text as the printer can print it: plain ASCII, one character per column.
 * Accents are dropped ("Résumé" → "Resume"), the symbols above become words,
 * tabs become spaces, and anything else unprintable becomes "?" — never a
 * raw byte the printer would read as a command.
 */
export function toReceiptText(text: string): string {
  let out = '';
  for (const character of text.normalize('NFC')) {
    const word = SYMBOL_WORDS[character];
    if (word !== undefined) {
      out += word;
      continue;
    }
    if (character === '\t') {
      out += ' ';
      continue;
    }
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) {
      out += character;
      continue;
    }
    // Strip the accent: "é" decomposes to "e" + a combining mark.
    const base = character.normalize('NFD').replace(/\p{M}/gu, '');
    const baseCode = base.codePointAt(0) ?? 0;
    out += base.length === 1 && baseCode >= 0x20 && baseCode <= 0x7e ? base : '?';
  }
  return out;
}

// ── layout ──────────────────────────────────────────────────────────────────

/** One laid-out row: already the printer's characters, already fitted to the width. */
export type ReceiptRow =
  | { kind: 'text'; text: string; align: ReceiptAlign; bold: boolean; double: boolean }
  | { kind: 'feed'; lines: number }
  | { kind: 'qr'; data: string }
  | { kind: 'cut' }
  | { kind: 'drawer' };

/** Words wrapped to `width` columns; a word longer than a line is broken across lines. */
export function wrapReceiptText(text: string, width: number): string[] {
  const rows: string[] = [];
  for (const paragraph of text.split('\n')) {
    let row = '';
    for (const word of paragraph.split(' ').filter((part) => part !== '')) {
      let rest = word;
      while (rest.length > width) {
        if (row) {
          rows.push(row);
          row = '';
        }
        rows.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if (!rest) continue;
      if (!row) row = rest;
      else if (row.length + 1 + rest.length <= width) row = `${row} ${rest}`;
      else {
        rows.push(row);
        row = rest;
      }
    }
    rows.push(row);
  }
  return rows;
}

/**
 * The receipt fitted to a printer: every row the printer will print, in
 * order. Both outputs read this — the ESC/POS bytes and the plain text — so
 * they cannot lay a receipt out differently.
 */
export function layoutReceipt(lines: readonly ReceiptLine[], profile: ReceiptPrinterProfile): ReceiptRow[] {
  const columns = RECEIPT_COLUMNS[profile.paperWidth];
  const rows: ReceiptRow[] = [];
  for (const line of lines) {
    switch (line.kind) {
      case 'text': {
        const double = line.size === 'double';
        const width = double ? Math.floor(columns / 2) : columns;
        for (const text of wrapReceiptText(toReceiptText(line.text), width)) {
          rows.push({ kind: 'text', text, align: line.align ?? 'left', bold: line.bold ?? false, double });
        }
        break;
      }
      case 'pair':
        for (const text of layoutPair(toReceiptText(line.left), toReceiptText(line.right), columns)) {
          rows.push({ kind: 'text', text, align: 'left', bold: line.bold ?? false, double: false });
        }
        break;
      case 'divider':
        rows.push({
          kind: 'text',
          text: (line.char ?? '-').repeat(columns),
          align: 'left',
          bold: false,
          double: false,
        });
        break;
      case 'feed':
        rows.push({ kind: 'feed', lines: Math.min(Math.max(Math.trunc(line.lines ?? 1), 1), 10) });
        break;
      case 'qr': {
        const data = toReceiptText(line.data);
        if (profile.qr && data.length > 0 && data.length <= RECEIPT_QR_MAX) {
          rows.push({ kind: 'qr', data });
          break;
        }
        // No QR on this printer (or too long for one): its text, so nothing is lost.
        for (const text of wrapReceiptText(data, columns)) {
          rows.push({ kind: 'text', text, align: 'center', bold: false, double: false });
        }
        break;
      }
      case 'cut':
        rows.push({ kind: 'cut' });
        break;
      case 'drawer':
        if (profile.drawer) rows.push({ kind: 'drawer' });
        break;
    }
  }
  return rows;
}

/**
 * A name and a price on one line, the price flush right. The name wraps onto
 * further lines; the price stays on the first. A price wider than the line
 * gets a line of its own, flush right.
 */
function layoutPair(left: string, right: string, columns: number): string[] {
  if (right.length >= columns) {
    return [...wrapReceiptText(left, columns), right.slice(-columns).padStart(columns)];
  }
  // One space at least between the name and the price.
  const room = columns - right.length - 1;
  const [first = '', ...rest] = wrapReceiptText(left, room);
  return [`${first.padEnd(room)} ${right}`, ...rest];
}

/** A row's text placed across `width` columns, as the printer's alignment would place it. */
function placed(text: string, align: ReceiptAlign, width: number): string {
  switch (align) {
    case 'left':
      return text;
    case 'right':
      return text.padStart(width);
    case 'center':
      return `${' '.repeat(Math.floor((width - text.length) / 2))}${text}`;
  }
}

/**
 * The receipt as plain text, a row per line, exactly as wide as the paper:
 * the preview (R3) and the narrow-page fallback on a normal printer (R5).
 * Double-size rows are shown at normal size, placed across the roll as printed.
 *
 * `markers` shows what paper cannot: the cut, the drawer, a QR code's place.
 */
export function receiptPlainText(
  lines: readonly ReceiptLine[],
  profile: ReceiptPrinterProfile,
  options: { markers?: boolean } = {},
): string {
  const columns = RECEIPT_COLUMNS[profile.paperWidth];
  const out: string[] = [];
  for (const row of layoutReceipt(lines, profile)) {
    switch (row.kind) {
      case 'text':
        // Across the whole roll, double size or not: a centred title prints centred.
        out.push(placed(row.text, row.align, columns).trimEnd());
        break;
      case 'feed':
        for (let i = 0; i < row.lines; i += 1) out.push('');
        break;
      case 'qr':
        out.push(placed(options.markers ? `[QR: ${row.data}]` : row.data, 'center', columns));
        break;
      case 'cut':
        if (options.markers) out.push(profile.cutter ? '✂'.padEnd(columns, '-') : '(tear here)');
        break;
      case 'drawer':
        if (options.markers) out.push('[drawer opened]');
        break;
    }
  }
  return out.join('\n');
}

// ── ESC/POS ─────────────────────────────────────────────────────────────────

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Feeds before a cut: the cutter sits a few lines above the print head, so the last line must clear it. */
export const RECEIPT_FEED_BEFORE_CUT = 4;

/** `ESC @`: reset — every style off, alignment left. First, always: the last job may have left bold on. */
const RESET = [ESC, 0x40];

function align(value: ReceiptAlign): number[] {
  switch (value) {
    case 'left':
      return [ESC, 0x61, 0];
    case 'center':
      return [ESC, 0x61, 1];
    case 'right':
      return [ESC, 0x61, 2];
  }
}

function bold(on: boolean): number[] {
  return [ESC, 0x45, on ? 1 : 0];
}

/** `GS ! n`: 0x11 is double width and double height; 0 is normal. */
function size(double: boolean): number[] {
  return [GS, 0x21, double ? 0x11 : 0x00];
}

function feed(lines: number): number[] {
  return [ESC, 0x64, lines];
}

/** `GS V B n`: feed `n` and partial cut — the tab left uncut stops a receipt falling on the floor. */
function cut(): number[] {
  return [GS, 0x56, 0x42, 0];
}

/** `ESC p 0 25 250`: a pulse on the drawer kick-out (pin 2), 50 ms on, 500 ms off — what drawers expect. */
const DRAWER = [ESC, 0x70, 0x00, 0x19, 0xfa];

/** `GS ( k`, QR model 2: choose the model, the module size, error correction M, store the data, print it. */
function qr(data: string): number[] {
  const bytes = ascii(data);
  const stored = bytes.length + 3;
  return [
    ...[GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00],
    ...[GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06],
    ...[GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31],
    ...[GS, 0x28, 0x6b, stored & 0xff, (stored >> 8) & 0xff, 0x31, 0x50, 0x30, ...bytes],
    ...[GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30],
  ];
}

/** Already-printable text (`toReceiptText`) as bytes: one byte per character, never a control byte. */
function ascii(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes.push(code >= 0x20 && code <= 0x7e ? code : 0x3f);
  }
  return bytes;
}

/**
 * The receipt as ESC/POS bytes for one printer: what the print agent sends it
 * unchanged (R2). Reset first; every style set per row and switched off after,
 * so one row's bold never leaks into the next; a cut feeds the paper past the
 * cutter first (and, with no cutter, only feeds it out to tear).
 */
export function encodeReceipt(lines: readonly ReceiptLine[], profile: ReceiptPrinterProfile): Uint8Array {
  const bytes: number[] = [...RESET];
  for (const row of layoutReceipt(lines, profile)) {
    switch (row.kind) {
      case 'text':
        bytes.push(...align(row.align));
        if (row.bold) bytes.push(...bold(true));
        if (row.double) bytes.push(...size(true));
        bytes.push(...ascii(row.text), LF);
        if (row.double) bytes.push(...size(false));
        if (row.bold) bytes.push(...bold(false));
        break;
      case 'feed':
        bytes.push(...feed(row.lines));
        break;
      case 'qr':
        bytes.push(...align('center'), ...qr(row.data), LF);
        break;
      case 'cut':
        bytes.push(...feed(RECEIPT_FEED_BEFORE_CUT));
        if (profile.cutter) bytes.push(...cut());
        break;
      case 'drawer':
        bytes.push(...DRAWER);
        break;
    }
  }
  // Back to left: the next job, a document's or this app's, starts from a known state.
  bytes.push(...align('left'));
  return Uint8Array.from(bytes);
}
