import { RECEIPT_COLUMNS, type ReceiptAlign, type ReceiptPaperWidth } from './receipt.js';

/**
 * ESC/POS bytes read back into what a receipt printer would put on paper
 * (#144, R3 #147): the virtual receipt printer's "paper", so receipts can be
 * built, sent and SEEN with no printer at all.
 *
 * It reads the commands `encodeReceipt` sends — and, because a test printer
 * should not hide surprises, it names any other command it meets instead of
 * dropping it: "[ESC t 16]" on the roll says a sender used something the
 * builder never does.
 */

/** One printed line, as the paper shows it. */
export interface ReadReceiptLine {
  text: string;
  align: ReceiptAlign;
  bold: boolean;
  double: boolean;
}

/** What came off the roll, in order. */
export type ReadReceiptMark =
  | ({ kind: 'line' } & ReadReceiptLine)
  | { kind: 'qr'; data: string }
  | { kind: 'cut'; partial: boolean }
  | { kind: 'drawer' }
  /** A command the reader does not know, as bytes in hex: shown, never dropped. */
  | { kind: 'unknown'; command: string };

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const hex = (bytes: readonly number[]): string =>
  bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/** `ESC a n`: 0 or "0" left, 1 or "1" centre, 2 or "2" right. */
function alignOf(n: number): ReceiptAlign {
  if (n === 1 || n === 0x31) return 'center';
  if (n === 2 || n === 0x32) return 'right';
  return 'left';
}

/** Reads every command and every line of text, in order. Never throws: a cut-short command is reported as unknown. */
export function readReceiptBytes(bytes: Uint8Array): ReadReceiptMark[] {
  const marks: ReadReceiptMark[] = [];
  let align: ReceiptAlign = 'left';
  let bold = false;
  let double = false;
  let text = '';
  let i = 0;
  /** A QR code's data is stored by one command and printed by another: held between them. */
  let pendingQr: string | null = null;

  const flush = (): void => {
    marks.push({ kind: 'line', text, align, bold, double });
    text = '';
  };
  /** The next `count` bytes after position `i`, or null when the input ends first. */
  const take = (count: number): number[] | null => {
    if (i + count > bytes.length) return null;
    const taken = [...bytes.subarray(i, i + count)];
    i += count;
    return taken;
  };
  const unknown = (from: number): void => {
    marks.push({ kind: 'unknown', command: hex([...bytes.subarray(from, Math.min(i, bytes.length))]) });
  };

  while (i < bytes.length) {
    const start = i;
    const byte = bytes[i] ?? 0;
    i += 1;
    if (byte === LF) {
      flush();
      continue;
    }
    if (byte >= 0x20 && byte <= 0x7e) {
      text += String.fromCharCode(byte);
      continue;
    }
    if (byte === ESC) {
      const command = take(1)?.[0];
      switch (command) {
        case 0x40: // ESC @: reset
          align = 'left';
          bold = false;
          double = false;
          continue;
        case 0x61: {
          // ESC a n: align
          const n = take(1)?.[0];
          if (n === undefined) break;
          align = alignOf(n);
          continue;
        }
        case 0x45: {
          // ESC E n: bold
          const n = take(1)?.[0];
          if (n === undefined) break;
          bold = (n & 1) === 1;
          continue;
        }
        case 0x64: {
          // ESC d n: print what is buffered, then feed n lines
          const n = take(1)?.[0];
          if (n === undefined) break;
          if (text) flush();
          for (let line = 0; line < n; line += 1)
            marks.push({ kind: 'line', text: '', align, bold: false, double: false });
          continue;
        }
        case 0x70: // ESC p m t1 t2: drawer pulse
          if (!take(3)) break;
          marks.push({ kind: 'drawer' });
          continue;
        default:
          break;
      }
      unknown(start);
      continue;
    }
    if (byte === GS) {
      const command = take(1)?.[0];
      switch (command) {
        case 0x21: {
          // GS ! n: character size
          const n = take(1)?.[0];
          if (n === undefined) break;
          double = n !== 0;
          continue;
        }
        case 0x56: {
          // GS V m [n]: cut. m 0/1/48/49 take no n; 65/66 take one.
          const m = take(1)?.[0];
          if (m === undefined) break;
          if (m === 65 || m === 66) take(1);
          if (text) flush();
          marks.push({ kind: 'cut', partial: m === 1 || m === 49 || m === 66 });
          continue;
        }
        case 0x28: {
          // GS ( k pL pH cn fn [data]: QR (cn 49); only "store" carries data and only "print" shows it
          const head = take(3);
          if (head?.[0] !== 0x6b) break;
          const length = (head[1] ?? 0) + (head[2] ?? 0) * 256;
          const body = take(length);
          if (!body) break;
          if (body[0] === 0x31 && body[1] === 0x50) {
            pendingQr = String.fromCharCode(...body.slice(3));
            continue;
          }
          if (body[0] === 0x31 && body[1] === 0x51) {
            marks.push({ kind: 'qr', data: pendingQr ?? '' });
            pendingQr = null;
            continue;
          }
          // Model, size, error correction: settings, nothing printed.
          continue;
        }
        default:
          break;
      }
      unknown(start);
      continue;
    }
    // Any other control byte: named, so a stray byte is visible on the test roll.
    unknown(start);
  }
  if (text) flush();
  return marks;
}

/**
 * The roll as text, `paperWidth` wide: what the virtual printer writes for a
 * developer to look at. Double-size lines are shown at normal size; bold is
 * not shown (the marks carry it); the cut, the drawer and a QR code appear as
 * markers, the same markers `receiptPlainText` uses.
 */
export function receiptPreview(bytes: Uint8Array, paperWidth: ReceiptPaperWidth): string {
  const columns = RECEIPT_COLUMNS[paperWidth];
  const out: string[] = [];
  for (const mark of readReceiptBytes(bytes)) {
    switch (mark.kind) {
      case 'line': {
        out.push(placedOnRoll(mark.text, mark.align, columns));
        break;
      }
      case 'qr':
        out.push(placedOnRoll(`[QR: ${mark.data}]`, 'center', columns));
        break;
      case 'cut':
        out.push('✂'.padEnd(columns, '-'));
        break;
      case 'drawer':
        out.push('[drawer opened]');
        break;
      case 'unknown':
        out.push(`[${mark.command}]`);
        break;
    }
  }
  return out.join('\n');
}

/** A line placed across the roll as the printer's alignment places it. */
function placedOnRoll(text: string, align: ReceiptAlign, columns: number): string {
  switch (align) {
    case 'left':
      return text;
    case 'right':
      return text.padStart(columns);
    case 'center':
      return `${' '.repeat(Math.max(Math.floor((columns - text.length) / 2), 0))}${text}`.trimEnd();
  }
}
