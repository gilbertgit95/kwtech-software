import { DEFAULT_FRAME } from '../src/domain/slot-fit.js';
import { inches, mm } from '../src/domain/units.js';
import {
  blurryWarning,
  cellsLike,
  filledCells,
  frameOf,
  hasCell,
  isHeicFile,
  isPdfFile,
  isPhotoFile,
  previewDpi,
  printLayoutName,
  pruneFrames,
  pruneSelection,
  refitPages,
  removePageFrames,
  resultFileName,
  STUDIO_ONCE_LAYOUT_NAME,
  setCellsPhoto,
  stepViewZoom,
  toggleCell,
  withFrame,
  withFrames,
} from '../src/react/view/work.js';

describe('frames', () => {
  const zoomed = { ...DEFAULT_FRAME, zoom: 2 };

  it('default until a cell is given one, and never change the map they were given', () => {
    const frames = {};
    const next = withFrame(frames, 0, 3, zoomed);
    expect(frameOf(frames, 0, 3)).toEqual(DEFAULT_FRAME);
    expect(frameOf(next, 0, 3)).toEqual(zoomed);
    expect(frameOf(next, 1, 3)).toEqual(DEFAULT_FRAME);
    expect(frames).toEqual({});
  });

  it('are dropped for a cell that is now empty and a page that is gone', () => {
    const frames = withFrame(withFrame(withFrame({}, 0, 0, zoomed), 0, 1, zoomed), 2, 0, zoomed);
    expect(pruneFrames(frames, [['p1', null]])).toEqual({ '0:0': zoomed });
  });
});

describe('selecting several cells', () => {
  // Page 1: ana, ana, empty, ben. Page 2: ana, ben.
  const pages = [
    ['ana', 'ana', null, 'ben'],
    ['ana', 'ben'],
  ];
  const at = { page: 0, cell: 0 };

  it('adds a cell with a Ctrl-click and takes it out with another', () => {
    const one = toggleCell([], at);
    const two = toggleCell(one, { page: 0, cell: 3 });
    expect(two).toEqual([at, { page: 0, cell: 3 }]);
    expect(toggleCell(two, at)).toEqual([{ page: 0, cell: 3 }]);
    expect(hasCell(two, { page: 0, cell: 3 })).toBe(true);
    expect(hasCell(two, { page: 1, cell: 3 })).toBe(false);
  });

  it('picks every cell holding the same photo, on every page, keeping the pressed one last', () => {
    expect(cellsLike(pages, 'photo', at)).toEqual([{ page: 0, cell: 1 }, { page: 1, cell: 0 }, at]);
  });

  it('picks every filled cell, and never an empty one', () => {
    expect(cellsLike(pages, 'all', at)).toHaveLength(5);
    expect(cellsLike(pages, 'all', at)).not.toContainEqual({ page: 0, cell: 2 });
  });

  it('picks nothing from an empty cell: there is no photo there to match', () => {
    expect(cellsLike(pages, 'photo', { page: 0, cell: 2 })).toEqual([]);
    expect(cellsLike(pages, 'all', { page: 0, cell: 2 })).toEqual([]);
  });

  it('knows which selected cells hold a photo', () => {
    const selection = [at, { page: 0, cell: 2 }];
    expect(filledCells(pages, selection)).toEqual([at]);
  });

  it('drops cells of a page that is gone', () => {
    expect(pruneSelection([at, { page: 1, cell: 1 }], [pages[0] ?? []])).toEqual([at]);
  });

  it('puts one photo in every selected cell, or empties them, without touching the rest', () => {
    const refs = [
      { page: 0, cell: 2 },
      { page: 1, cell: 1 },
    ];
    expect(setCellsPhoto(pages, refs, 'cal')).toEqual([
      ['ana', 'ana', 'cal', 'ben'],
      ['ana', 'cal'],
    ]);
    expect(setCellsPhoto(pages, [at], null)[0]).toEqual([null, 'ana', null, 'ben']);
    expect(pages[0]).toEqual(['ana', 'ana', null, 'ben']);
  });

  it('gives one frame to all of them and leaves the others as they were', () => {
    const zoomed = { ...DEFAULT_FRAME, zoom: 2 };
    const turned = { ...DEFAULT_FRAME, rotation: 90 as const };
    const before = { '0:3': turned };
    const after = withFrames(before, cellsLike(pages, 'photo', at), zoomed);
    expect(after).toEqual({ '0:3': turned, '0:0': zoomed, '0:1': zoomed, '1:0': zoomed });
    expect(before).toEqual({ '0:3': turned });
  });
});

describe('removing a page', () => {
  it('drops its frames and moves every later page’s down one', () => {
    const zoomed = { ...DEFAULT_FRAME, zoom: 2 };
    const turned = { ...DEFAULT_FRAME, rotation: 90 as const };
    const frames = { '0:1': zoomed, '1:0': zoomed, '2:3': turned };
    expect(removePageFrames(frames, 1)).toEqual({ '0:1': zoomed, '1:3': turned });
  });
});

describe('the preview', () => {
  it('is drawn at the resolution that makes the sheet about as wide as asked', () => {
    expect(previewDpi({ width: inches(4), height: inches(6) }, 800)).toBe(200);
    expect(previewDpi({ width: mm(210), height: mm(297) }, 800)).toBeCloseTo(96.76, 1);
  });

  it('never goes past the result’s own resolution, or below a readable one', () => {
    expect(previewDpi({ width: inches(1), height: inches(1) }, 5000)).toBe(300);
    expect(previewDpi({ width: inches(80), height: inches(80) }, 800)).toBe(24);
    expect(previewDpi({ width: 0, height: 0 }, 800)).toBe(72);
  });
});

describe('zooming the view', () => {
  it('steps up and down through the sizes, and stops at either end', () => {
    expect(stepViewZoom(1, 1)).toBe(1.5);
    expect(stepViewZoom(2, 1)).toBe(3);
    expect(stepViewZoom(6, 1)).toBe(6);
    expect(stepViewZoom(3, -1)).toBe(2);
    expect(stepViewZoom(1, -1)).toBe(1);
  });

  it('finds the nearest step from a size that is not one', () => {
    expect(stepViewZoom(1.7, 1)).toBe(2);
    expect(stepViewZoom(1.7, -1)).toBe(1.5);
  });
});

describe('the blurry warning', () => {
  it('is said below 150 dots per inch and not at or above it', () => {
    expect(blurryWarning(149)).toContain('149 dots per inch');
    expect(blurryWarning(150)).toBeNull();
    expect(blurryWarning(600)).toBeNull();
  });
});

describe('resultFileName', () => {
  it('makes the layout’s name safe for a file system', () => {
    expect(resultFileName('ID package on 4R')).toBe('ID-package-on-4R.pdf');
    expect(resultFileName('2 × 2 and 1 × 1 on A4')).toBe('2-x-2-and-1-x-1-on-A4.pdf');
    expect(resultFileName('../../etc/passwd')).toBe('etcpasswd.pdf');
    expect(resultFileName('  ')).toBe('print.pdf');
    expect(resultFileName('x'.repeat(200))).toHaveLength(64);
  });
});

describe('file kinds', () => {
  it('knows a photo by its type or, failing that, its name', () => {
    expect(isPhotoFile({ name: 'a.bin', type: 'image/jpeg' })).toBe(true);
    expect(isPhotoFile({ name: 'IMG_0001.HEIC', type: '' })).toBe(true);
    expect(isPhotoFile({ name: 'a.gif', type: 'image/gif' })).toBe(true);
    expect(isPhotoFile({ name: 'download.JFIF', type: '' })).toBe(true);
    expect(isPhotoFile({ name: 'a.bmp', type: 'image/bmp' })).toBe(false);
    expect(isPhotoFile({ name: 'a.pdf', type: 'application/pdf' })).toBe(false);
  });

  it('knows HEIC and PDF', () => {
    expect(isHeicFile({ name: 'a.heif', type: '' })).toBe(true);
    expect(isHeicFile({ name: 'a.jpg', type: 'image/jpeg' })).toBe(false);
    expect(isPdfFile({ name: 'scan.PDF', type: '' })).toBe(true);
    expect(isPdfFile({ name: 'a.docx', type: '' })).toBe(false);
  });
});

describe('a layout adjusted for one print', () => {
  const cell = (x: number, y: number) => ({ x, y, width: mm(40), height: mm(40) });
  // Reading order is the order they are written in: two across, then the row under them.
  const two = [cell(0, 0), cell(mm(50), 0)];
  const three = [...two, cell(0, mm(50))];

  it('leaves every photo in its cell when the cells were only moved or resized', () => {
    const pages = [
      ['ana', null],
      ['ben', 'ana'],
    ];
    const moved = [cell(mm(5), mm(5)), cell(mm(60), 0)];
    expect(refitPages(pages, moved)).toEqual({ pages, dropped: 0, kept: true });
  });

  it('gives each page its one photo in every new cell: the same photo, or a customer a page', () => {
    const refit = refitPages(
      [
        ['ana', 'ana'],
        ['ben', null],
        [null, null],
      ],
      three,
    );
    expect(refit.kept).toBe(false);
    expect(refit.pages).toEqual([
      ['ana', 'ana', 'ana'],
      ['ben', 'ben', 'ben'],
      [null, null, null],
    ]);
  });

  it('lays mixed photos out one per cell again, and only the ones that were placed', () => {
    // "cy" was added to the tray and never put on the sheet: it stays there.
    const refit = refitPages(
      [
        ['ana', 'ben'],
        ['dan', null],
      ],
      three,
    );
    expect(refit).toEqual({ pages: [['ana', 'ben', 'dan']], dropped: 0, kept: false });
  });

  it('is one empty page when nothing was placed yet', () => {
    expect(refitPages([[null, null]], three)).toEqual({ pages: [[null, null, null]], dropped: 0, kept: false });
  });

  it('is named so the history does not take it for the saved layout', () => {
    expect(printLayoutName('ID package', true)).toBe('ID package, adjusted');
    expect(printLayoutName('ID package', false)).toBe('ID package');
    expect(resultFileName(printLayoutName('ID package', true))).toBe('ID-package-adjusted.pdf');
    expect(resultFileName(STUDIO_ONCE_LAYOUT_NAME)).toBe('One-time-layout.pdf');
  });
});
