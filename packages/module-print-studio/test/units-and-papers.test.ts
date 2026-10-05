import { STUDIO_PAPERS } from '../src/domain/papers.js';
import { findStudioCellSize, STUDIO_CELL_SIZES, STUDIO_ID_SIZES } from '../src/domain/sizes.js';
import { formatLength, formatSize, inches, mm, toPixels, toPoints } from '../src/domain/units.js';

describe('units', () => {
  it('makes an inch exactly 2540, so photo sizes are whole numbers', () => {
    expect(inches(1)).toBe(2540);
    expect(inches(1.5)).toBe(3810);
    expect(inches(2.5)).toBe(6350);
    expect(mm(25.4)).toBe(inches(1));
  });

  it('adds three inches without the float error millimetres would have', () => {
    expect(inches(1) * 3).toBe(mm(76.2));
    // The sum this module exists to avoid.
    expect(25.4 * 3).not.toBe(76.2);
  });

  it('draws a 1 × 1 as exactly 300 pixels at 300 dpi and 72 points in a PDF', () => {
    expect(toPixels(inches(1))).toBe(300);
    expect(toPixels(inches(4))).toBe(1200);
    expect(toPoints(inches(1))).toBe(72);
    expect(toPoints(mm(210))).toBeCloseTo(595.2756, 3);
  });

  it('shows a length without trailing zeros', () => {
    expect(formatLength(inches(1), 'in')).toBe('1 in');
    expect(formatLength(inches(1), 'mm')).toBe('25.4 mm');
    expect(formatSize(inches(4), inches(6), 'in')).toBe('4 × 6 in');
    expect(formatSize(mm(210), mm(297), 'mm')).toBe('210 × 297 mm');
  });
});

describe('the built-in papers', () => {
  it('are all stored portrait, with unique keys', () => {
    for (const paper of STUDIO_PAPERS) expect(paper.width).toBeLessThanOrEqual(paper.height);
    expect(new Set(STUDIO_PAPERS.map((paper) => paper.key)).size).toBe(STUDIO_PAPERS.length);
  });

  it('keeps long bond and legal as different papers', () => {
    const folio = STUDIO_PAPERS.find((paper) => paper.key === 'folio');
    const legal = STUDIO_PAPERS.find((paper) => paper.key === 'legal');
    expect(folio?.height).toBe(inches(13));
    expect(legal?.height).toBe(inches(14));
    expect(folio?.label).toBe('Long bond');
  });

  it('has the photo sizes at their lab dimensions', () => {
    const size = (key: string) => {
      const paper = STUDIO_PAPERS.find((entry) => entry.key === key);
      return [paper?.width, paper?.height];
    };
    expect(size('2r')).toEqual([inches(2.5), inches(3.5)]);
    expect(size('4r')).toEqual([inches(4), inches(6)]);
    expect(size('8r')).toEqual([inches(8), inches(10)]);
    expect(size('s8r')).toEqual([inches(8), inches(12)]);
  });
});

describe('the built-in cell sizes', () => {
  it('offer the ID sizes and every paper as a cell', () => {
    expect(STUDIO_ID_SIZES.map((size) => size.key)).toEqual(['1x1', '1.5x1.5', '2x2', 'passport', 'wallet']);
    expect(findStudioCellSize('paper:2r')?.width).toBe(inches(2.5));
    expect(new Set(STUDIO_CELL_SIZES.map((size) => size.key)).size).toBe(STUDIO_CELL_SIZES.length);
  });

  it('makes a passport photo 35 × 45 mm', () => {
    expect(findStudioCellSize('passport')).toMatchObject({ width: mm(35), height: mm(45) });
  });
});
