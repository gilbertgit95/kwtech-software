import { inches, mm } from './units.js';

/**
 * The papers the studio offers by name (PRINT-STUDIO-PLAN §3).
 *
 * Data, not a table: a paper is a fact about the world, the same in every
 * workspace, and a layout COPIES the size it was made on (`StudioLayoutSpec.paper`)
 * so retiring or correcting an entry here never changes a saved layout.
 *
 * ⚠ EVERY PAPER IS STORED PORTRAIT (`width <= height`). Landscape is the
 * layout's `orientation`, never a second entry — two entries for one paper
 * would be two things to keep in step.
 */
export interface StudioPaper {
  /** ⚠ Copied into saved layouts. Never rename one; add a new entry instead. */
  key: string;
  label: string;
  /** What shops here also call it, shown beside the label. */
  alias?: string;
  group: 'office' | 'photo';
  /** Hundredths of a millimetre. */
  width: number;
  height: number;
  /** The unit its size is quoted in, so "4 × 6 in" is not shown as "101.6 × 152.4 mm". */
  unit: 'mm' | 'in';
}

export const STUDIO_PAPERS: readonly StudioPaper[] = [
  // ── office papers ─────────────────────────────────────────────────────────
  { key: 'a4', label: 'A4', group: 'office', width: mm(210), height: mm(297), unit: 'mm' },
  { key: 'a5', label: 'A5', group: 'office', width: mm(148), height: mm(210), unit: 'mm' },
  {
    key: 'letter',
    label: 'Short bond',
    alias: 'Letter',
    group: 'office',
    width: inches(8.5),
    height: inches(11),
    unit: 'in',
  },
  /*
   * ⚠ LONG BOND IS NOT LEGAL. Long bond (Folio) is 13 inches; Legal is 14.
   * Shops call both "long", and a layout made for one clips or leaves a gap on
   * the other — so both are here, under their own names.
   */
  {
    key: 'folio',
    label: 'Long bond',
    alias: 'Folio',
    group: 'office',
    width: inches(8.5),
    height: inches(13),
    unit: 'in',
  },
  { key: 'legal', label: 'Legal', group: 'office', width: inches(8.5), height: inches(14), unit: 'in' },

  // ── photo papers ──────────────────────────────────────────────────────────
  { key: '2r', label: '2R', alias: 'Wallet', group: 'photo', width: inches(2.5), height: inches(3.5), unit: 'in' },
  { key: '3r', label: '3R', group: 'photo', width: inches(3.5), height: inches(5), unit: 'in' },
  { key: '4r', label: '4R', group: 'photo', width: inches(4), height: inches(6), unit: 'in' },
  { key: '5r', label: '5R', group: 'photo', width: inches(5), height: inches(7), unit: 'in' },
  { key: '6r', label: '6R', group: 'photo', width: inches(6), height: inches(8), unit: 'in' },
  { key: '8r', label: '8R', group: 'photo', width: inches(8), height: inches(10), unit: 'in' },
  { key: 's8r', label: 'S8R', group: 'photo', width: inches(8), height: inches(12), unit: 'in' },
];

/** A built-in paper by its key, or undefined for a custom or retired one. */
export function findStudioPaper(key: string | null | undefined): StudioPaper | undefined {
  if (!key) return undefined;
  return STUDIO_PAPERS.find((paper) => paper.key === key);
}

/**
 * The smallest and largest side a paper may have.
 *
 * The floor is a business card's short side; the ceiling is two metres, past
 * any printer this is for. ⚠ The ceiling also BOUNDS THE RENDERER: a sheet is
 * drawn as pixels, and an unbounded paper is an unbounded canvas.
 */
export const STUDIO_PAPER_MIN = mm(20);
export const STUDIO_PAPER_MAX = mm(2000);
