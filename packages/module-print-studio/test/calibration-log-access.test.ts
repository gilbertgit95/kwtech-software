import { canSeeLayout, checkShareLayout, isStudioVisibility, planChangeLayout } from '../src/domain/access.js';
import {
  applyCalibration,
  isNoCalibration,
  NO_CALIBRATION,
  prepareCalibration,
  prepareCalibrationName,
  rulerLengthFor,
  scaleFromMeasurement,
} from '../src/domain/calibration.js';
import { cleanFileNames, logCutoff, prepareLogEntry, STUDIO_LOG_FILE_NAMES_MAX } from '../src/domain/log.js';
import { mm } from '../src/domain/units.js';
import type { StudioLayoutFacts } from '../src/types.js';

describe('calibration', () => {
  it('draws larger to make up for a printer that shrinks', () => {
    // A 100 mm line that measured 99 mm.
    expect(scaleFromMeasurement(mm(100), mm(99))).toBe(10101);
    expect(scaleFromMeasurement(mm(100), mm(100))).toBe(10000);
    expect(scaleFromMeasurement(mm(100), mm(101))).toBe(9901);
  });

  it('refuses a measurement so far out it is a wrong setting, not a tolerance', () => {
    expect(scaleFromMeasurement(mm(100), mm(80))).toBeNull();
    expect(scaleFromMeasurement(mm(100), 0)).toBeNull();
    expect(scaleFromMeasurement(mm(100), Number.NaN)).toBeNull();
  });

  it('scales about the centre of the sheet, then shifts', () => {
    const sheet = { width: mm(100), height: mm(200) };
    const centred = { x: mm(40), y: mm(90), width: mm(20), height: mm(20) };
    const scaled = applyCalibration(centred, sheet, { scaleX: 11000, scaleY: 10000, offsetX: mm(1), offsetY: -mm(2) });
    expect(scaled).toEqual({ x: mm(39) + mm(1), y: mm(90) - mm(2), width: mm(22), height: mm(20) });
    expect(applyCalibration(centred, sheet, NO_CALIBRATION)).toEqual(centred);
    expect(isNoCalibration(NO_CALIBRATION)).toBe(true);
  });

  it('accepts a profile inside its bounds and refuses one outside', () => {
    expect(prepareCalibration({ scaleX: 10050, scaleY: 9990, offsetX: 50, offsetY: -50 })).toEqual({
      calibration: { scaleX: 10050, scaleY: 9990, offsetX: 50, offsetY: -50 },
    });
    expect(prepareCalibration({ scaleX: 12000, scaleY: 10000, offsetX: 0, offsetY: 0 })).toEqual({
      refused: 'invalid_calibration',
    });
    expect(prepareCalibration({ scaleX: 10000, scaleY: 10000, offsetX: mm(11), offsetY: 0 })).toEqual({
      refused: 'invalid_calibration',
    });
    expect(prepareCalibration({ scaleX: 10000.5, scaleY: 10000, offsetX: 0, offsetY: 0 })).toEqual({
      refused: 'invalid_calibration',
    });
    expect(prepareCalibration(null)).toEqual({ refused: 'invalid_calibration' });
  });

  it('draws a 100 mm ruler where it fits, and a shorter whole-centimetre one on a small paper', () => {
    expect(rulerLengthFor({ width: mm(204), height: mm(291) })).toBe(mm(100));
    // A 2R with 3 mm margins: 57.5 mm across, less the 20 mm the labels need.
    expect(rulerLengthFor({ width: mm(57.5), height: mm(82.9) })).toBe(mm(30));
    expect(rulerLengthFor({ width: mm(25), height: mm(25) })).toBe(mm(20));
  });

  it('names a profile with one clean line', () => {
    expect(prepareCalibrationName(' Epson L3210,\t4R ')).toEqual({ name: 'Epson L3210, 4R' });
    expect(prepareCalibrationName('')).toEqual({ refused: 'invalid_name' });
  });
});

describe('the print log', () => {
  const entry = {
    action: 'downloaded',
    kind: 'layout',
    layoutId: 'clx123',
    layoutName: ' ID package ',
    paperLabel: '4R',
    paperWidth: 10160,
    paperHeight: 15240,
    pages: 2,
    copies: 1,
    fileNames: ['juan.jpg'],
  };

  it('keeps a clean entry', () => {
    expect(prepareLogEntry(entry)).toEqual({ entry: { ...entry, layoutName: 'ID package' } });
  });

  it('has no layout for a preset or an unsaved one', () => {
    const result = prepareLogEntry({ ...entry, layoutId: null, layoutName: null });
    expect(result).toMatchObject({ entry: { layoutId: null, layoutName: null } });
  });

  it.each([
    ['an action it has not heard of', { action: 'printed' }],
    ['a kind it has not heard of', { kind: 'poster' }],
    ['no pages', { pages: 0 }],
    ['a fractional copy count', { copies: 1.5 }],
    ['file names that are not a list', { fileNames: 'juan.jpg' }],
  ])('refuses %s', (_name, overrides) => {
    expect(prepareLogEntry({ ...entry, ...overrides })).toEqual({ refused: 'invalid_log' });
  });

  it('keeps the file name and drops the folder it came from', () => {
    expect(cleanFileNames(['C:\\Users\\maria\\Customers\\juan dela cruz.jpg', '/home/ana/scan.png'])).toEqual([
      'juan dela cruz.jpg',
      'scan.png',
    ]);
  });

  it('keeps each name once, drops what is not a name, and caps the count and length', () => {
    expect(cleanFileNames(['a.jpg', 'a.jpg', 7, '', '  '])).toEqual(['a.jpg']);
    const many = Array.from({ length: STUDIO_LOG_FILE_NAMES_MAX + 10 }, (_name, index) => `${index}.jpg`);
    expect(cleanFileNames(many)).toHaveLength(STUDIO_LOG_FILE_NAMES_MAX);
    expect(cleanFileNames(['x'.repeat(500)])[0]).toHaveLength(120);
  });

  it('prunes what is older than the keep', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    expect(logCutoff(now).toISOString()).toBe('2026-07-07T12:00:00.000Z');
    expect(logCutoff(now, 1).toISOString()).toBe('2026-10-04T12:00:00.000Z');
    // A keep of nothing would delete the entry being written.
    expect(logCutoff(now, 0).toISOString()).toBe('2026-10-04T12:00:00.000Z');
  });
});

const OWNER = 'user-owner';
const OTHER = 'user-other';
const layout = (overrides: Partial<StudioLayoutFacts> = {}): StudioLayoutFacts => ({
  ownerId: OWNER,
  visibility: 'private',
  ...overrides,
});

describe('who may do what to a layout', () => {
  it('shows a private layout to its owner and nobody else', () => {
    expect(canSeeLayout(layout(), OWNER)).toBe(true);
    expect(canSeeLayout(layout(), OTHER)).toBe(false);
    expect(canSeeLayout(layout({ visibility: 'workspace' }), OTHER)).toBe(true);
  });

  /**
   * ⚠ THE ORACLE. For somebody else's private layout every check must answer
   * exactly `not_found` — the answer a layout that does not exist gets.
   */
  it('answers not_found for every act on somebody else’s private layout', () => {
    expect(planChangeLayout(layout(), OTHER)).toEqual({ kind: 'refused', reason: 'not_found' });
    expect(checkShareLayout(layout(), OTHER)).toBe('not_found');
  });

  it('lets the owner change their own, private or shared', () => {
    expect(planChangeLayout(layout(), OWNER)).toEqual({ kind: 'allowed' });
    expect(planChangeLayout(layout({ visibility: 'workspace' }), OWNER)).toEqual({ kind: 'allowed' });
  });

  it('asks for manage_all before anybody else changes a shared layout', () => {
    expect(planChangeLayout(layout({ visibility: 'workspace' }), OTHER)).toEqual({ kind: 'needs_manage_all' });
  });

  it('keeps sharing and unsharing to the owner', () => {
    expect(checkShareLayout(layout(), OWNER)).toBeNull();
    expect(checkShareLayout(layout({ visibility: 'workspace' }), OTHER)).toBe('not_owner');
  });

  it('narrows a visibility off the wire', () => {
    expect(isStudioVisibility('workspace')).toBe(true);
    expect(isStudioVisibility('public')).toBe(false);
  });
});
