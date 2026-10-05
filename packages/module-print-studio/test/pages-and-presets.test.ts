import { checkCells, printableArea, sheetSize } from '../src/domain/layout.js';
import { groupIntoSheets, parsePageRange, placeInSlot, sheetSlots } from '../src/domain/page-layout.js';
import { defaultLayoutSpec, findStudioPreset, STUDIO_PRESETS } from '../src/domain/presets.js';
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

describe('the shipped presets', () => {
  it('are all valid layouts with at least one cell, under unique keys', () => {
    for (const preset of STUDIO_PRESETS) {
      expect(preset.spec.cells.length).toBeGreaterThan(0);
      expect(checkCells(preset.spec.cells, printableArea(preset.spec))).toBeNull();
    }
    expect(new Set(STUDIO_PRESETS.map((preset) => preset.key)).size).toBe(STUDIO_PRESETS.length);
  });

  it('⚠ are all on A4, portrait, with 12 mm kept clear on the left and the right', () => {
    for (const preset of STUDIO_PRESETS) {
      expect([preset.key, preset.spec.paper.key, preset.spec.orientation]).toEqual([preset.key, 'a4', 'portrait']);
      expect(preset.spec.margins).toEqual({ top: mm(3), right: mm(12), bottom: mm(3), left: mm(12) });
    }
  });

  it('⚠ stop every cell at least one inch above the centre of the sheet, so the lower half is used again', () => {
    for (const preset of STUDIO_PRESETS) {
      const limit = sheetSize(preset.spec).height / 2 - inches(1);
      // A cell's `y` is from the printable area's top; the limit is from the sheet's.
      const lowest = Math.max(...preset.spec.cells.map((cell) => preset.spec.margins.top + cell.y + cell.height));
      expect([preset.key, lowest <= limit]).toEqual([preset.key, true]);
    }
  });

  it('offer each ID size by itself: 28 of 1 × 1, 12 of 1.5 × 1.5, 6 of 2 × 2 and 12 passport', () => {
    expect(findStudioPreset('a4-strip-1x1')?.spec.cells).toHaveLength(28);
    expect(findStudioPreset('a4-strip-1.5x1.5')?.spec.cells).toHaveLength(12);
    expect(findStudioPreset('a4-strip-2x2')?.spec.cells).toHaveLength(6);
    expect(findStudioPreset('a4-strip-passport')?.spec.cells).toHaveLength(12);
  });

  it('⚠ leave no gap: neighbouring cells touch, so one cut separates two photos — and the guides show where', () => {
    const preset = findStudioPreset('a4-strip-1x1');
    const [first, second] = preset?.spec.cells ?? [];
    expect(second?.x).toBe((first?.x ?? 0) + inches(1));
    expect(STUDIO_PRESETS.every((one) => one.spec.guides)).toBe(true);
  });

  it('build a combination: the larger size first, 1 × 1s in what is left of the strip', () => {
    const cells = findStudioPreset('a4-strip-2x2-1x1')?.spec.cells ?? [];
    expect(cells.filter((cell) => cell.width === inches(2))).toHaveLength(2);
    expect(cells.filter((cell) => cell.width === inches(1))).toHaveLength(20);
    expect(cells[0]?.label).toBe('2 × 2');
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
