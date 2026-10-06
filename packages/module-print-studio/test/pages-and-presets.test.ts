import { checkCells, printableArea, sheetSize } from '../src/domain/layout.js';
import { groupIntoSheets, parsePageRange, placeInSlot, sheetSlots } from '../src/domain/page-layout.js';
import { defaultLayoutSpec, findStudioPreset, STUDIO_PRESETS, studioPresetGroups } from '../src/domain/presets.js';
import { inches, mm } from '../src/domain/units.js';

describe('parsePageRange', () => {
  it('reads every page from an empty range', () => {
    expect(parsePageRange('', 3)).toEqual([0, 1, 2]);
    expect(parsePageRange('  ', 0)).toEqual([]);
  });

  it('reads pages, ranges and open ranges in the order asked for', () => {
    expect(parsePageRange('1-3, 5', 10)).toEqual([0, 1, 2, 4]);
    expect(parsePageRange('8-', 10)).toEqual([7, 8, 9]);
    expect(parsePageRange('-2', 10)).toEqual([0, 1]);
    expect(parsePageRange('5,1', 10)).toEqual([4, 0]);
  });

  it('drops pages past the end rather than refusing', () => {
    expect(parsePageRange('1-20', 3)).toEqual([0, 1, 2]);
    expect(parsePageRange('9', 3)).toEqual([]);
  });

  it.each(['abc', '3-1', '0', '1,,2', '-', '3 5', '1-2-3'])('refuses "%s"', (text) => {
    expect(parsePageRange(text, 10)).toBeNull();
  });
});

describe('pages on a sheet', () => {
  it('groups pages into sheets, the last one short', () => {
    expect(groupIntoSheets([0, 1, 2, 3, 4], 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(groupIntoSheets([], 4)).toEqual([]);
  });

  it('puts two pages side by side on a wide area and one above the other on a tall one', () => {
    const wide = sheetSlots({ width: mm(200), height: mm(100) }, 2, mm(4));
    expect(wide).toEqual([
      { x: 0, y: 0, width: mm(98), height: mm(100) },
      { x: mm(102), y: 0, width: mm(98), height: mm(100) },
    ]);
    const tall = sheetSlots({ width: mm(100), height: mm(200) }, 2, mm(4));
    expect(tall[1]).toEqual({ x: 0, y: mm(102), width: mm(100), height: mm(98) });
  });

  it('puts four pages two by two', () => {
    const slots = sheetSlots({ width: mm(200), height: mm(100) }, 4, 0);
    expect(slots).toHaveLength(4);
    expect(slots[3]).toEqual({ x: mm(100), y: mm(50), width: mm(100), height: mm(50) });
  });

  it('fits a page whole, fills the slot, or keeps its own size — always centred', () => {
    const page = { width: mm(100), height: mm(200) };
    const slot = { width: mm(100), height: mm(100) };
    expect(placeInSlot(page, slot, 'fit')).toEqual({ x: mm(25), y: 0, width: mm(50), height: mm(100) });
    expect(placeInSlot(page, slot, 'fill')).toEqual({ x: 0, y: -mm(50), width: mm(100), height: mm(200) });
    expect(placeInSlot(page, slot, 'actual')).toEqual({ x: 0, y: -mm(50), width: mm(100), height: mm(200) });
  });
});

/** The ID photo packages: strips in the top half. The PVC ID sheet is tagged ID too, but uses the whole page. */
const STRIPS = STUDIO_PRESETS.filter((preset) => preset.tag === 'id' && preset.key !== 'a4-id-pvc').map(
  (preset) => preset.key,
);

describe('the shipped presets', () => {
  it('are all valid layouts with at least one cell, under unique keys', () => {
    for (const preset of STUDIO_PRESETS) {
      expect(preset.spec.cells.length).toBeGreaterThan(0);
      expect(checkCells(preset.spec.cells, printableArea(preset.spec))).toBeNull();
    }
    expect(new Set(STUDIO_PRESETS.map((preset) => preset.key)).size).toBe(STUDIO_PRESETS.length);
  });

  it('⚠ are all on A4, portrait, with the operator’s margins: 24 mm clear at the bottom, or 3 mm all round a page grid', () => {
    for (const preset of STUDIO_PRESETS) {
      expect([preset.key, preset.spec.paper.key, preset.spec.orientation]).toEqual([preset.key, 'a4', 'portrait']);
      if (preset.tag === 'page-grid') {
        expect(preset.spec.margins).toEqual({ top: mm(3), right: mm(3), bottom: mm(3), left: mm(3) });
        continue;
      }
      const side = preset.tag === 'id' ? mm(12) : mm(9);
      // The strips start 5 mm down; the sheets that use the whole page start at 3.
      const top = STRIPS.includes(preset.key) ? mm(5) : mm(3);
      expect([preset.key, preset.spec.margins]).toEqual([preset.key, { top, right: side, bottom: mm(24), left: side }]);
    }
  });

  it('⚠ are the layouts the operator drew, and the two grids built to their pattern, cell for cell', () => {
    const counts = STUDIO_PRESETS.map((preset) => [preset.name, preset.spec.cells.length]);
    expect(counts).toEqual([
      ['ID Package - 1, 2', 13],
      ['ID Package - 1x1', 21],
      ['ID Package - 2x2', 6],
      ['ID Package - 1.5x1.5', 8],
      ['ID Package - Passport', 10],
      ['ID Package - 1, 1.5, 2', 12],
      ['ID Package - 1, 1.5, 2, Passport', 12],
      ['ID Package - PVC ID Size', 10],
      ['Photo Printing - 2R', 9],
      ['Photo Printing - Wallet Size', 9],
      ['Photo Printing - 3R', 4],
      ['Photo Printing - 4R', 2],
      ['Photo Printing - 5R', 2],
      ['Photo Printing - 6R', 1],
      ['A4 - Full', 1],
      ['A4 - 1x2 grid', 2],
      ['A4 - 2x2 grid', 4],
      ['A4 - 2x3 grid', 6],
      ['A4 - 3x3 grid', 9],
    ]);
  });

  it('group by tag in the registry’s order — ID, Photo Print, Page Grid — leaving out a tag with nothing in it', () => {
    const groups = studioPresetGroups();
    expect(groups.map((group) => [group.label, group.presets.length])).toEqual([
      ['ID', 8],
      ['Photo Print', 6],
      ['Page Grid', 5],
    ]);
    expect(groups.flatMap((group) => group.presets)).toHaveLength(STUDIO_PRESETS.length);
    const photos = STUDIO_PRESETS.filter((preset) => preset.tag === 'photo-print');
    expect(studioPresetGroups(photos).map((group) => group.key)).toEqual(['photo-print']);
  });

  it('⚠ keep every ID photo package in the top half of the sheet, so the lower half is used again', () => {
    expect(STRIPS).toHaveLength(7);
    for (const preset of STUDIO_PRESETS.filter((one) => STRIPS.includes(one.key))) {
      // A cell's `y` is from the printable area's top; the limit is from the sheet's.
      const lowest = Math.max(...preset.spec.cells.map((cell) => preset.spec.margins.top + cell.y + cell.height));
      expect([preset.key, lowest <= sheetSize(preset.spec).height / 2]).toEqual([preset.key, true]);
    }
  });

  it('⚠ leave no gap: neighbouring cells touch, so one cut separates two photos — and the guides show where', () => {
    const preset = findStudioPreset('a4-id-1x1');
    const [first, second] = preset?.spec.cells ?? [];
    expect(second?.x).toBe((first?.x ?? 0) + inches(1));
    expect(STUDIO_PRESETS.every((one) => one.spec.guides)).toBe(true);
  });

  it('place a mixed package exactly where it was drawn, each cell labelled with its size', () => {
    const cells = findStudioPreset('a4-id-1-2')?.spec.cells ?? [];
    expect(cells[0]).toEqual({ x: 169, y: 0, width: inches(1), height: inches(1), label: '1 × 1' });
    expect(cells[9]).toEqual({ x: 7789, y: 0, width: inches(2), height: inches(2), label: '2 × 2' });
  });

  it('carry a PVC ID card as a typed size: ten on their sides, labelled as the editor labelled them', () => {
    const cells = findStudioPreset('a4-id-pvc')?.spec.cells ?? [];
    expect(cells[1]).toEqual({ x: mm(85.6), y: 0, width: mm(85.6), height: mm(54), label: '54 × 85.6 mm' });
    expect(cells[9]).toMatchObject({ x: mm(85.6), y: mm(216) });
  });

  it('⚠ divide an A4 into equal, unlabelled cells that fill the printable area, running down each column', () => {
    const two = findStudioPreset('a4-grid-2x2')?.spec.cells ?? [];
    // Exactly what the operator saved: 102 × 145.5 mm, the second cell BELOW the first.
    expect(two).toEqual([
      { x: 0, y: 0, width: 10200, height: 14550 },
      { x: 0, y: 14550, width: 10200, height: 14550 },
      { x: 10200, y: 0, width: 10200, height: 14550 },
      { x: 10200, y: 14550, width: 10200, height: 14550 },
    ]);
    const six = findStudioPreset('a4-grid-2x3')?.spec.cells ?? [];
    expect(six[2]).toEqual({ x: 0, y: mm(194), width: mm(102), height: mm(97) });
    expect(six[3]).toEqual({ x: mm(102), y: 0, width: mm(102), height: mm(97) });
    const nine = findStudioPreset('a4-grid-3x3')?.spec.cells ?? [];
    expect(nine[8]).toEqual({ x: mm(136), y: mm(194), width: mm(68), height: mm(97) });

    for (const preset of STUDIO_PRESETS.filter((one) => one.tag === 'page-grid')) {
      const area = printableArea(preset.spec);
      const covered = preset.spec.cells.reduce((sum, cell) => sum + cell.width * cell.height, 0);
      expect([preset.key, covered]).toEqual([preset.key, area.width * area.height]);
    }
  });

  it('lay 4R and 5R photos on their sides, and 6R upright', () => {
    expect(findStudioPreset('a4-photo-4r')?.spec.cells[1]).toEqual({
      x: 0,
      y: inches(4),
      width: inches(6),
      height: inches(4),
      label: '4R',
    });
    expect(findStudioPreset('a4-photo-5r')?.spec.cells[0]).toMatchObject({ width: inches(7), height: inches(5) });
    expect(findStudioPreset('a4-photo-6r')?.spec.cells[0]).toMatchObject({ width: inches(6), height: inches(8) });
  });

  it('start a new layout on the same paper and margins, with no cells', () => {
    const blank = defaultLayoutSpec();
    expect(blank.paper.key).toBe('a4');
    expect(blank.margins).toEqual({ top: mm(3), right: mm(12), bottom: mm(3), left: mm(12) });
    expect(blank.cells).toEqual([]);
    // 210 mm less 12 mm each side.
    expect(printableArea(blank).width).toBe(mm(186));
  });
});
