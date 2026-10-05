import {
  emptyLayoutSpec,
  printableArea,
  type StudioCell,
  type StudioLayoutSpec,
  type StudioMargins,
  type StudioSize,
  sheetSize,
} from './layout.js';
import { findStudioPaper, type StudioPaper } from './papers.js';
import { addOfSize, fillWithSize } from './place.js';
import { findStudioCellSize } from './sizes.js';
import { inches, mm } from './units.js';

/**
 * Layouts that come with the studio, for a workspace to use as they are or
 * copy and change (PRINT-STUDIO-PLAN §3).
 *
 * ⚠ BUILT BY THE EDITOR'S OWN TOOLS (`place.ts`), not typed in as coordinates:
 * a preset is then exactly what a person would get by doing the same steps,
 * and a wrong number cannot hide in a list of four hundred.
 *
 * ⚠ NOT ROWS. A preset belongs to nobody, counts against no limit and cannot
 * be edited; using one copies its spec into the studio. So improving one here
 * never changes a layout somebody saved from it.
 */
export interface StudioPreset {
  /** ⚠ Shown in the log as the layout's name. Never rename one; add a new entry instead. */
  key: string;
  name: string;
  description: string;
  spec: StudioLayoutSpec;
}

/**
 * What a new layout and every preset start from: an A4 sheet, with the margins
 * the operator's printers need (2026-10-05).
 *
 * ⚠ 12 mm ON THE LEFT AND RIGHT: those printers cannot reach the outer edge of
 * either side, and a cell placed there prints cut off. (First set to 15 mm;
 * the operator measured and asked for 12.) The top and bottom keep 3 mm, the
 * usual lead-in. A workspace with a different printer changes the margins in
 * step 2 of the editor.
 */
export const STUDIO_DEFAULT_PAPER_KEY = 'a4';
export const STUDIO_DEFAULT_MARGINS: StudioMargins = { top: mm(3), right: mm(12), bottom: mm(3), left: mm(12) };

/** A new, empty layout: the default paper and margins, no cells. */
export function defaultLayoutSpec(): StudioLayoutSpec {
  const paper = requirePaper(STUDIO_DEFAULT_PAPER_KEY);
  return {
    ...emptyLayoutSpec({ key: paper.key, label: paper.label, width: paper.width, height: paper.height }, 0),
    margins: { ...STUDIO_DEFAULT_MARGINS },
  };
}

/**
 * The gap a preset leaves between cells: none (the operator, 2026-10-05).
 *
 * Cells that touch share one cut: a row of 1 × 1s is cut once between each
 * pair instead of twice, and no sliver of paper is left to trim. The cut
 * guides are what show where one photo ends and the next begins.
 */
const PRESET_GAP = 0;

/**
 * How far short of the sheet's centre a preset's cells stop: one inch.
 *
 * A set of ID photos is a strip, not a page. Kept to ALMOST the top half, the
 * sheet is cut across the middle and the lower half goes back in the tray for
 * the next customer — and the inch left clear above the centre line is room
 * for the cut and for the fingers holding the strip.
 */
const PRESET_CENTRE_ALLOWANCE = inches(1);

interface PresetStep {
  size: string;
  /** How many to place; omitted means as many as fit in the band. */
  count?: number;
}

function buildPreset(key: string, name: string, description: string, steps: readonly PresetStep[]) {
  const spec = defaultLayoutSpec();
  const area = printableArea(spec);
  // From the printable area's top down to one inch above the sheet's centre.
  const reach = Math.floor(sheetSize(spec).height / 2) - PRESET_CENTRE_ALLOWANCE - area.y;
  // The tools place into THIS box, so nothing they produce can pass the band's lower edge.
  const band: StudioSize = { width: area.width, height: reach };

  let cells: StudioCell[] = [];
  for (const step of steps) {
    const size = requireSize(step.size);
    const options = { gap: PRESET_GAP, label: size.label };
    const placement =
      step.count === undefined
        ? fillWithSize(band, cells, size, options)
        : addOfSize(band, cells, size, step.count, options);
    cells = placement.cells;
  }
  return { key, name, description, spec: { ...spec, cells } } satisfies StudioPreset;
}

/** A missing key here is a typo in this file, found the first time the module loads. */
function requirePaper(key: string): StudioPaper {
  const paper = findStudioPaper(key);
  if (!paper) throw new Error(`Studio preset names the paper "${key}", which STUDIO_PAPERS does not have.`);
  return paper;
}

function requireSize(key: string): StudioSize & { label: string } {
  const size = findStudioCellSize(key);
  if (!size) throw new Error(`Studio preset names the size "${key}", which STUDIO_CELL_SIZES does not have.`);
  return size;
}

const STRIP = 'in the top half of an A4 sheet';

export const STUDIO_PRESETS: readonly StudioPreset[] = [
  buildPreset('a4-strip-1x1', '1 × 1 strip', `1 × 1 ID photos ${STRIP}.`, [{ size: '1x1' }]),
  buildPreset('a4-strip-1.5x1.5', '1.5 × 1.5 strip', `1.5 × 1.5 ID photos ${STRIP}.`, [{ size: '1.5x1.5' }]),
  buildPreset('a4-strip-2x2', '2 × 2 strip', `2 × 2 ID photos ${STRIP}.`, [{ size: '2x2' }]),
  buildPreset('a4-strip-passport', 'Passport strip', `Passport photos ${STRIP}.`, [{ size: 'passport' }]),
  buildPreset(
    'a4-strip-2x2-1x1',
    '2 × 2 and 1 × 1 strip',
    `Two 2 × 2 photos, and 1 × 1 photos beside them, ${STRIP}.`,
    [{ size: '2x2', count: 2 }, { size: '1x1' }],
  ),
  buildPreset(
    'a4-strip-1.5x1.5-1x1',
    '1.5 × 1.5 and 1 × 1 strip',
    `Two 1.5 × 1.5 photos, and 1 × 1 photos beside them, ${STRIP}.`,
    [{ size: '1.5x1.5', count: 2 }, { size: '1x1' }],
  ),
  buildPreset(
    'a4-strip-passport-1x1',
    'Passport and 1 × 1 strip',
    `Two passport photos, and 1 × 1 photos beside them, ${STRIP}.`,
    [{ size: 'passport', count: 2 }, { size: '1x1' }],
  ),
];

export function findStudioPreset(key: string | null | undefined): StudioPreset | undefined {
  if (!key) return undefined;
  return STUDIO_PRESETS.find((preset) => preset.key === key);
}
