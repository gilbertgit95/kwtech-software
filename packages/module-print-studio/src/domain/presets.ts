import {
  emptyLayoutSpec,
  printableArea,
  type StudioCell,
  type StudioLayoutSpec,
  type StudioMargins,
} from './layout.js';
import { findStudioPaper, type StudioPaper } from './papers.js';
import { findStudioCellSize, type StudioCellSize } from './sizes.js';
import { mm } from './units.js';

/**
 * Layouts that come with the studio, for a workspace to use as they are or
 * copy and change (PRINT-STUDIO-PLAN §3).
 *
 * ⚠ THE OPERATOR'S OWN LAYOUTS, COPIED EXACTLY (2026-10-06). They drew these
 * in the editor for their printers and paper, and asked for them to replace
 * the strips the studio first shipped with. Every position below is what they
 * saved, in the order they placed it — the order photos fill the cells in —
 * so do not tidy a number or re-sort a list: a cell that moves is a photo cut
 * in the wrong place. Only the positions are written out; each cell's size and
 * label come from `STUDIO_CELL_SIZES`. (The PVC ID sheet was added the same
 * way later that day.)
 *
 * ⚠ NOT ROWS. A preset belongs to nobody, counts against no limit and cannot
 * be edited; using one copies its spec into the studio. So improving one here
 * never changes a layout somebody saved from it.
 */
export interface StudioPreset {
  /** ⚠ Shown in the log as the layout's name. Never rename one; add a new entry instead. */
  key: string;
  /** What kind of work it is for; the screens group the presets by it. */
  tag: StudioPresetTagKey;
  name: string;
  description: string;
  spec: StudioLayoutSpec;
}

/**
 * The kinds of work the presets are for, in the order the screens show them.
 *
 * A registry rather than free text on each preset: a tag typed twice with two
 * spellings would be two groups on the screen, and `satisfies` below turns a
 * preset naming a tag that is not here into a compile error.
 */
export const STUDIO_PRESET_TAGS = [
  { key: 'id', label: 'ID' },
  { key: 'photo-print', label: 'Photo Print' },
  { key: 'page-grid', label: 'Page Grid' },
] as const satisfies readonly { key: string; label: string }[];

export type StudioPresetTagKey = (typeof STUDIO_PRESET_TAGS)[number]['key'];

/**
 * What a new layout starts from: an A4 sheet, with the margins
 * the operator's printers need (2026-10-05).
 *
 * ⚠ 12 mm ON THE LEFT AND RIGHT: those printers cannot reach the outer edge of
 * either side, and a cell placed there prints cut off. (First set to 15 mm;
 * the operator measured and asked for 12.) The top and bottom keep 3 mm, the
 * usual lead-in. A workspace with a different printer changes the margins in
 * step 2 of the editor. (The presets carry their own margins, below.)
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
 * The margins the operator set for each kind of preset.
 *
 * ⚠ 24 mm AT THE BOTTOM on both: the last stretch of the sheet their printers
 * cannot feed. The ID packages keep the 12 mm sides of a new layout; the photo
 * sheets narrow them to 9 mm, which is what lets three 2R photos (190.5 mm)
 * sit side by side on an A4.
 */
const ID_MARGINS: StudioMargins = { top: mm(5), right: mm(12), bottom: mm(24), left: mm(12) };
const PHOTO_MARGINS: StudioMargins = { top: mm(3), right: mm(9), bottom: mm(24), left: mm(9) };
/** The PVC ID sheet uses the whole page, so it starts 3 mm from the top like the photo sheets, on the ID packages' sides. */
const CARD_MARGINS: StudioMargins = { top: mm(3), right: mm(12), bottom: mm(24), left: mm(12) };

/**
 * A PVC ID card (CR80, the size of a bank card), as the operator typed it.
 *
 * ⚠ NOT IN `STUDIO_CELL_SIZES`: it was a custom size, so the preset carries it
 * here, with the label the editor gave it, rather than adding a size to every
 * workspace's palette that nobody asked for.
 */
const PVC_ID_CARD = { label: '54 × 85.6 mm', width: mm(54), height: mm(85.6) };

/** Cells of one size, at the places they were drawn. */
interface PresetCells {
  /** A key of `STUDIO_CELL_SIZES`, or a size written out for one that was typed. */
  size: string | { label: string; width: number; height: number };
  /** On its side: the size's height across and its width down. */
  turned?: boolean;
  /** Each cell's `[x, y]` from the printable area's top left, in hundredths of a millimetre. */
  at: readonly (readonly [number, number])[];
}

function preset(
  key: string,
  tag: StudioPresetTagKey,
  name: string,
  description: string,
  margins: StudioMargins,
  groups: readonly PresetCells[],
): StudioPreset {
  const cells: StudioCell[] = [];
  for (const group of groups) {
    const size = typeof group.size === 'string' ? requireSize(group.size) : group.size;
    const width = group.turned ? size.height : size.width;
    const height = group.turned ? size.width : size.height;
    for (const [x, y] of group.at) cells.push({ x, y, width, height, label: size.label });
  }
  return { key, tag, name, description, spec: { ...defaultLayoutSpec(), margins: { ...margins }, cells } };
}

/**
 * The margin of a page grid: 3 mm on every side, the least the operator's
 * printers leave, so the cells are as large as the sheet allows.
 */
const GRID_MARGIN = mm(3);

/**
 * A whole A4 divided into equal cells, `columns` across and `rows` down — for
 * printing several pictures or pages to a sheet, with nothing left over.
 *
 * The operator drew Full, 1x2 and 2x2 (2026-10-06) and asked for 2x3 and 3x3
 * "in the same pattern", so these ARE built, unlike the packages above: the
 * three drawn ones come out of this exactly as saved, and a test holds them
 * there.
 *
 * ⚠ THE CELLS RUN DOWN EACH COLUMN, then across — the order the operator's 2x2
 * was saved in, and so the order photos fill a grid in. They carry no label:
 * a grid cell is not a named size.
 *
 * ⚠ PERCENT LAYOUTS (the operator, 2026-10-07): a grid is "the page in four",
 * not four cells of a size, so on another paper it is still that paper in
 * four. The numbers below are the grid on A4, where it was drawn.
 *
 * ⚠ ONLY COUNTS THAT DIVIDE THE AREA EXACTLY. 204 × 291 mm divides by 1, 2
 * and 3 both ways; a count that left a remainder would leave a sliver at the
 * edge, and this throws rather than round it away.
 */
function pageGrid(key: string, name: string, description: string, columns: number, rows: number): StudioPreset {
  const base = defaultLayoutSpec();
  const margins = { top: GRID_MARGIN, right: GRID_MARGIN, bottom: GRID_MARGIN, left: GRID_MARGIN };
  const area = printableArea({ ...base, margins });
  if (area.width % columns !== 0 || area.height % rows !== 0) {
    throw new Error(`Studio preset "${key}" does not divide the sheet into ${columns} × ${rows} equal cells.`);
  }
  const width = area.width / columns;
  const height = area.height / rows;
  const cells: StudioCell[] = [];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) cells.push({ x: column * width, y: row * height, width, height });
  }
  return { key, tag: 'page-grid', name, description, spec: { ...base, margins, cells, sizing: 'percent' } };
}

/** A missing key here is a typo in this file, found the first time the module loads. */
function requirePaper(key: string): StudioPaper {
  const paper = findStudioPaper(key);
  if (!paper) throw new Error(`Studio preset names the paper "${key}", which STUDIO_PAPERS does not have.`);
  return paper;
}

function requireSize(key: string): StudioCellSize {
  const size = findStudioCellSize(key);
  if (!size) throw new Error(`Studio preset names the size "${key}", which STUDIO_CELL_SIZES does not have.`);
  return size;
}

// biome-ignore format: one line of positions per size reads against the sheet; one number per line does not.
export const STUDIO_PRESETS: readonly StudioPreset[] = [
  preset('a4-id-1-2', 'id', 'ID Package - 1, 2', 'Nine 1 × 1 and four 2 × 2 ID photos at the top of an A4 sheet.', ID_MARGINS, [
    { size: '1x1', at: [[169, 0], [2709, 0], [5249, 0], [169, 2540], [2709, 2540], [5249, 2540], [169, 5080], [2709, 5080], [5249, 5080]] },
    { size: '2x2', at: [[7789, 0], [12869, 0], [7789, 5080], [12869, 5080]] },
  ]),
  preset('a4-id-1x1', 'id', 'ID Package - 1x1', 'Twenty-one 1 × 1 ID photos at the top of an A4 sheet.', ID_MARGINS, [
    { size: '1x1', at: [[169, 0], [2709, 0], [5249, 0], [169, 2540], [2709, 2540], [5249, 2540], [169, 5080], [2709, 5080], [5249, 5080], [7789, 0], [10329, 0], [12869, 0], [7789, 2540], [10329, 2540], [12869, 2540], [7789, 5080], [10329, 5080], [12869, 5080], [15409, 0], [15409, 2540], [15409, 5080]] },
  ]),
  preset('a4-id-2x2', 'id', 'ID Package - 2x2', 'Six 2 × 2 ID photos at the top of an A4 sheet.', ID_MARGINS, [
    { size: '2x2', at: [[0, 0], [5080, 0], [10160, 0], [0, 5080], [5080, 5080], [10160, 5080]] },
  ]),
  preset('a4-id-1.5x1.5', 'id', 'ID Package - 1.5x1.5', 'Eight 1.5 × 1.5 ID photos at the top of an A4 sheet.', ID_MARGINS, [
    { size: '1.5x1.5', at: [[0, 0], [3810, 0], [7620, 0], [11430, 0], [0, 3810], [3810, 3810], [7620, 3810], [11430, 3810]] },
  ]),
  preset('a4-id-passport', 'id', 'ID Package - Passport', 'Ten passport photos at the top of an A4 sheet.', ID_MARGINS, [
    { size: 'passport', at: [[0, 0], [3500, 0], [7000, 0], [10500, 0], [14000, 0], [0, 4500], [3500, 4500], [7000, 4500], [10500, 4500], [14000, 4500]] },
  ]),
  preset('a4-id-1-1.5-2', 'id', 'ID Package - 1, 1.5, 2', 'Six 1 × 1, four 1.5 × 1.5 and two 2 × 2 ID photos at the top of an A4 sheet.', ID_MARGINS, [
    { size: '1x1', at: [[169, 0], [2709, 0], [169, 2540], [2709, 2540], [169, 5080], [2709, 5080]] },
    { size: '2x2', at: [[12869, 0], [12869, 5080]] },
    { size: '1.5x1.5', at: [[5249, 0], [9059, 0], [5249, 3810], [9059, 3810]] },
  ]),
  preset('a4-id-1-1.5-2-passport', 'id', 'ID Package - 1, 1.5, 2, Passport', 'Six 1 × 1, two 1.5 × 1.5, two passport and two 2 × 2 ID photos at the top of an A4 sheet.', ID_MARGINS, [
    { size: '1x1', at: [[169, 0], [2709, 0], [169, 2540], [2709, 2540], [169, 5080], [2709, 5080]] },
    { size: '2x2', at: [[12559, 0], [12559, 5080]] },
    { size: '1.5x1.5', at: [[5249, 0], [5249, 3810]] },
    { size: 'passport', at: [[9059, 0], [9059, 4500]] },
  ]),
  preset('a4-id-pvc', 'id', 'ID Package - PVC ID Size', 'Ten PVC ID cards, on their sides, on an A4 sheet.', CARD_MARGINS, [
    { size: PVC_ID_CARD, turned: true, at: [[0, 0], [8560, 0], [0, 5400], [8560, 5400], [0, 10800], [8560, 10800], [0, 16200], [8560, 16200], [0, 21600], [8560, 21600]] },
  ]),
  preset('a4-photo-2r', 'photo-print', 'Photo Printing - 2R', 'Nine 2R photos on an A4 sheet.', PHOTO_MARGINS, [
    { size: 'paper:2r', at: [[0, 0], [6350, 0], [0, 8890], [6350, 8890], [0, 17780], [12700, 0], [12700, 8890], [6350, 17780], [12700, 17780]] },
  ]),
  preset('a4-photo-wallet', 'photo-print', 'Photo Printing - Wallet Size', 'Nine wallet photos on an A4 sheet.', PHOTO_MARGINS, [
    { size: 'wallet', at: [[0, 0], [5080, 0], [10160, 0], [0, 7620], [5080, 7620], [10160, 7620], [0, 15240], [5080, 15240], [10160, 15240]] },
  ]),
  preset('a4-photo-3r', 'photo-print', 'Photo Printing - 3R', 'Four 3R photos on an A4 sheet.', PHOTO_MARGINS, [
    { size: 'paper:3r', at: [[0, 0], [8890, 0], [0, 12700], [8890, 12700]] },
  ]),
  preset('a4-photo-4r', 'photo-print', 'Photo Printing - 4R', 'Two 4R photos, on their sides, on an A4 sheet.', PHOTO_MARGINS, [
    { size: 'paper:4r', turned: true, at: [[0, 0], [0, 10160]] },
  ]),
  preset('a4-photo-5r', 'photo-print', 'Photo Printing - 5R', 'Two 5R photos, on their sides, on an A4 sheet.', PHOTO_MARGINS, [
    { size: 'paper:5r', turned: true, at: [[0, 0], [0, 12700]] },
  ]),
  preset('a4-photo-6r', 'photo-print', 'Photo Printing - 6R', 'One 6R photo on an A4 sheet.', PHOTO_MARGINS, [
    { size: 'paper:6r', at: [[0, 0]] },
  ]),
  pageGrid('a4-grid-full', 'A4 - Full', 'One cell filling an A4 sheet.', 1, 1),
  pageGrid('a4-grid-1x2', 'A4 - 1x2 grid', 'An A4 sheet in two equal cells, one above the other.', 1, 2),
  pageGrid('a4-grid-2x2', 'A4 - 2x2 grid', 'An A4 sheet in four equal cells.', 2, 2),
  pageGrid('a4-grid-2x3', 'A4 - 2x3 grid', 'An A4 sheet in six equal cells: two across, three down.', 2, 3),
  pageGrid('a4-grid-3x3', 'A4 - 3x3 grid', 'An A4 sheet in nine equal cells.', 3, 3),
];

export function findStudioPreset(key: string | null | undefined): StudioPreset | undefined {
  if (!key) return undefined;
  return STUDIO_PRESETS.find((preset) => preset.key === key);
}

export interface StudioPresetGroup {
  key: StudioPresetTagKey;
  label: string;
  presets: readonly StudioPreset[];
}

/** The presets under their tags, in registry order. A tag with no preset is left out, never shown empty. */
export function studioPresetGroups(presets: readonly StudioPreset[] = STUDIO_PRESETS): StudioPresetGroup[] {
  return STUDIO_PRESET_TAGS.map((tag) => ({
    key: tag.key,
    label: tag.label,
    presets: presets.filter((preset) => preset.tag === tag.key),
  })).filter((group) => group.presets.length > 0);
}
