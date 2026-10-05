import { STUDIO_PAPERS } from './papers.js';
import { inches, mm } from './units.js';

/**
 * The sizes a cell can be made at by name (PRINT-STUDIO-PLAN §3).
 *
 * Data, like the papers, and COPIED into a layout as plain widths and heights:
 * a cell remembers its size, not this entry, so nothing here can move a cell
 * in a saved layout.
 */
export interface StudioCellSize {
  key: string;
  label: string;
  /** Hundredths of a millimetre. As a person holds it: `width` across, `height` down. */
  width: number;
  height: number;
  unit: 'mm' | 'in';
}

/**
 * The ID and wallet sizes.
 *
 * ⚠ `passport` IS 35 × 45 mm, the ICAO size most countries use. It is to be
 * checked against the current DFA requirement before this ships
 * (PRINT-STUDIO-PLAN §3); a shop that needs another types it as a custom size.
 *
 * ⚠ `wallet` IS 2 × 3 in. Labs also sell 2.5 × 3.5 in as "wallet" — that one
 * is 2R, and is offered as a paper-sized cell below.
 */
export const STUDIO_ID_SIZES: readonly StudioCellSize[] = [
  { key: '1x1', label: '1 × 1', width: inches(1), height: inches(1), unit: 'in' },
  { key: '1.5x1.5', label: '1.5 × 1.5', width: inches(1.5), height: inches(1.5), unit: 'in' },
  { key: '2x2', label: '2 × 2', width: inches(2), height: inches(2), unit: 'in' },
  { key: 'passport', label: 'Passport', width: mm(35), height: mm(45), unit: 'mm' },
  { key: 'wallet', label: 'Wallet', width: inches(2), height: inches(3), unit: 'in' },
];

/**
 * Every named size a cell can take: the ID sizes, then every paper — a 2R
 * photo on an A4 sheet is a cell the size of a 2R paper.
 */
export const STUDIO_CELL_SIZES: readonly StudioCellSize[] = [
  ...STUDIO_ID_SIZES,
  ...STUDIO_PAPERS.map((paper) => ({
    key: `paper:${paper.key}`,
    label: paper.label,
    width: paper.width,
    height: paper.height,
    unit: paper.unit,
  })),
];

export function findStudioCellSize(key: string | null | undefined): StudioCellSize | undefined {
  if (!key) return undefined;
  return STUDIO_CELL_SIZES.find((size) => size.key === key);
}

/**
 * The smallest side a cell may have: 5 mm. Smaller is a mis-drag, not a photo,
 * and a cell of zero would divide by zero in every fit calculation.
 */
export const STUDIO_CELL_MIN = mm(5);
