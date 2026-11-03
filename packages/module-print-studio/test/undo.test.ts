import { emptyLayoutSpec, type StudioLayoutSpec } from '../src/domain/layout.js';
import {
  commitUndo,
  redoLabel,
  redoStep,
  STUDIO_UNDO_GESTURE_MS,
  STUDIO_UNDO_LIMIT,
  type StudioUndo,
  startUndo,
  undoLabel,
  undoStates,
  undoStep,
} from '../src/domain/undo.js';
import { mm } from '../src/domain/units.js';
import {
  clearedPrintSheet,
  keptSelection,
  newPrintSheet,
  pageChangeLabel,
  photoEditStep,
  printSheetPhotoIds,
  selectionKey,
  undoButtonLabel,
  withAddedPhotos,
  withoutPhoto,
} from '../src/react/view/undo-steps.js';
import { NO_PHOTO_EDIT } from '../src/react/view/work.js';

/** A history of plain numbers: what the rules do does not depend on what is kept. */
function history(...values: number[]): StudioUndo<number> {
  let made = startUndo(values[0] ?? 0);
  for (const value of values.slice(1)) made = commitUndo(made, value, { label: `to ${value}` });
  return made;
}

describe('the undo history', () => {
  it('starts with nothing to undo or redo', () => {
    const fresh = startUndo('a');
    expect([fresh.present, undoLabel(fresh), redoLabel(fresh)]).toEqual(['a', null, null]);
  });

  it('undoes a change, and redoes it, naming it both ways', () => {
    const made = history(1, 2);
    expect(undoLabel(made)).toBe('to 2');
    const undone = undoStep(made);
    expect([undone.present, undoLabel(undone), redoLabel(undone)]).toEqual([1, null, 'to 2']);
    const redone = redoStep(undone);
    expect([redone.present, undoLabel(redone), redoLabel(redone)]).toEqual([2, 'to 2', null]);
  });

  it('steps back and forward through several changes in order', () => {
    const made = history(1, 2, 3, 4);
    const back = undoStep(undoStep(undoStep(made)));
    expect(back.present).toBe(1);
    expect(redoStep(back).present).toBe(2);
    expect(redoStep(redoStep(redoStep(back))).present).toBe(4);
  });

  it('does nothing when there is nothing to undo or redo', () => {
    const fresh = startUndo(1);
    expect(undoStep(fresh)).toBe(fresh);
    expect(redoStep(fresh)).toBe(fresh);
  });

  it('⚠ clears what could be redone once a new change is made after an undo', () => {
    const undone = undoStep(history(1, 2, 3));
    const changed = commitUndo(undone, 9, { label: 'to 9' });
    expect([changed.present, redoLabel(changed), changed.future]).toEqual([9, null, []]);
    expect(undoStep(changed).present).toBe(2);
  });

  it('adds no step for an update that changed nothing', () => {
    const made = history(1, 2);
    expect(commitUndo(made, made.present, { label: 'nothing' })).toBe(made);
  });

  it('⚠ keeps at most the cap, dropping the oldest steps', () => {
    let made = startUndo(0);
    for (let value = 1; value <= STUDIO_UNDO_LIMIT + 20; value += 1) {
      made = commitUndo(made, value, { label: `to ${value}` });
    }
    expect(made.past).toHaveLength(STUDIO_UNDO_LIMIT);
    let back = made;
    for (let step = 0; step < STUDIO_UNDO_LIMIT + 5; step += 1) back = undoStep(back);
    // As far back as the cap goes: the first 20 changes can no longer be undone.
    expect(back.present).toBe(20);
    expect(commitUndo(startUndo(0), 1, { label: 'x', limit: 1 }).past).toHaveLength(1);
  });

  it('lists every snapshot it holds, so nothing they name is let go of', () => {
    const undone = undoStep(history(1, 2, 3));
    expect(undoStates(undone)).toEqual([1, 2, 3]);
  });
});

describe('one gesture, one step', () => {
  const at = 10_000;

  it('joins a gesture’s events into the step it began', () => {
    let made = startUndo(0);
    for (let move = 1; move <= 40; move += 1) {
      made = commitUndo(made, move, { label: 'zoom', gesture: { key: 'zoom', at: at + move * 16 } });
    }
    expect([made.present, made.past.length]).toEqual([40, 1]);
    expect(undoStep(made).present).toBe(0);
  });

  it('starts a new step for another gesture, or a press', () => {
    let made = commitUndo(startUndo(0), 1, { label: 'zoom', gesture: { key: 'zoom:0:1', at } });
    made = commitUndo(made, 2, { label: 'zoom', gesture: { key: 'zoom:0:2', at: at + 10 } });
    expect(made.past).toHaveLength(2);
    made = commitUndo(made, 3, { label: 'turn' });
    made = commitUndo(made, 4, { label: 'zoom', gesture: { key: 'zoom:0:2', at: at + 20 } });
    expect(made.past).toHaveLength(4);
  });

  it('⚠ ends a timed gesture after a pause: the slider moved again later is a step of its own', () => {
    const first = commitUndo(startUndo(0), 1, { label: 'zoom', gesture: { key: 'zoom', at } });
    const soon = commitUndo(first, 2, { label: 'zoom', gesture: { key: 'zoom', at: at + STUDIO_UNDO_GESTURE_MS } });
    expect(soon.past).toHaveLength(1);
    const later = commitUndo(soon, 3, {
      label: 'zoom',
      gesture: { key: 'zoom', at: at + 2 * STUDIO_UNDO_GESTURE_MS + 1 },
    });
    expect(later.past).toHaveLength(2);
  });

  it('keeps a drag one step however long the hand rests mid-drag', () => {
    const drag = (when: number) => ({ label: 'move photo', gesture: { key: 'drag:1', at: when, untimed: true } });
    let made = commitUndo(startUndo(0), 1, drag(at));
    made = commitUndo(made, 2, drag(at + 60_000));
    expect([made.present, made.past.length]).toEqual([2, 1]);
  });

  it('never joins across an undo: the next event starts a step', () => {
    const first = commitUndo(startUndo(0), 1, { label: 'zoom', gesture: { key: 'zoom', at } });
    const undone = undoStep(first);
    const again = commitUndo(undone, 5, { label: 'zoom', gesture: { key: 'zoom', at: at + 10 } });
    expect([again.past.length, undoStep(again).present]).toEqual([1, 0]);
  });
});

/** A layout of two cells side by side on A4, enough for the sheet's rules. */
const SPEC: StudioLayoutSpec = {
  ...emptyLayoutSpec({ key: 'a4', label: 'A4', width: mm(210), height: mm(297) }, mm(5)),
  cells: [
    { x: 0, y: 0, width: mm(35), height: mm(45) },
    { x: mm(40), y: 0, width: mm(35), height: mm(45) },
  ],
};

describe('the Print screen’s snapshot', () => {
  it('starts empty, with the layout’s own border', () => {
    const sheet = newPrintSheet(SPEC);
    expect([sheet.photoIds, sheet.pages, sheet.background, sheet.guides]).toEqual([
      [],
      [[null, null]],
      null,
      SPEC.guides,
    ]);
  });

  it('⚠ fills the empty sheet in the same step as the photos are added', () => {
    const one = withAddedPhotos(newPrintSheet(SPEC), ['a'], SPEC.cells);
    expect(one.sheet.pages).toEqual([['a', 'a']]);
    const two = withAddedPhotos(newPrintSheet(SPEC), ['a', 'b'], SPEC.cells);
    expect(two.sheet.pages).toEqual([['a', 'b']]);
    // Once anything is placed, more photos only join the tray.
    const more = withAddedPhotos(two.sheet, ['c'], SPEC.cells);
    expect([more.sheet.photoIds, more.sheet.pages]).toEqual([['a', 'b', 'c'], [['a', 'b']]]);
  });

  it('takes a removed photo out of every cell, and an undo of it brings both back', () => {
    const placed = withAddedPhotos(newPrintSheet(SPEC), ['a', 'b'], SPEC.cells).sheet;
    let made = startUndo(placed);
    made = commitUndo(made, withoutPhoto(placed, 'a'), { label: 'remove photo' });
    expect([made.present.photoIds, made.present.pages]).toEqual([['b'], [[null, 'b']]]);
    const back = undoStep(made).present;
    expect([back.photoIds, back.pages]).toEqual([['a', 'b'], [['a', 'b']]]);
    // While the step that names it is held, the photo must not be released.
    expect(new Set(undoStates(made).flatMap(printSheetPhotoIds)).has('a')).toBe(true);
  });

  it('names the background’s photo among the ones held', () => {
    const sheet = {
      ...newPrintSheet(SPEC),
      photoIds: ['a'],
      background: { photoId: 'bg', placement: {} as never },
    };
    expect(printSheetPhotoIds(sheet)).toEqual(['a', 'bg']);
    expect(printSheetPhotoIds(clearedPrintSheet(sheet, SPEC.cells))).toEqual([]);
  });

  it('keeps the selection to cells that are still there after an undo', () => {
    const selection = [
      { page: 0, cell: 1 },
      { page: 1, cell: 0 },
    ];
    expect(keptSelection(selection, [[null, null]], 2)).toEqual([{ page: 0, cell: 1 }]);
    expect(keptSelection(selection, [[null, null]], 1)).toEqual([]);
    expect(
      keptSelection(
        selection,
        [
          [null, null],
          [null, null],
        ],
        2,
      ),
    ).toBe(selection);
  });

  it('keys a gesture by the cells it acts on', () => {
    expect(
      selectionKey([
        { page: 0, cell: 1 },
        { page: 2, cell: 3 },
      ]),
    ).toBe('0:1,2:3');
  });
});

describe('what each step is called', () => {
  it('makes a slider a gesture and a flip a press', () => {
    const lit = { ...NO_PHOTO_EDIT, lighting: { ...NO_PHOTO_EDIT.lighting, brightness: 0.2 } };
    expect(photoEditStep(NO_PHOTO_EDIT, lit)).toEqual({ label: 'colour', gesture: 'lighting' });
    const cropped = { ...NO_PHOTO_EDIT, crop: { x: 0.1, y: 0, width: 0.9, height: 1 } };
    expect(photoEditStep(NO_PHOTO_EDIT, cropped)).toEqual({ label: 'crop', gesture: 'crop' });
    expect(photoEditStep(NO_PHOTO_EDIT, { ...NO_PHOTO_EDIT, flipH: true })).toEqual({ label: 'flip', gesture: null });
    expect(photoEditStep({ ...lit, ...cropped, flipV: true }, NO_PHOTO_EDIT)).toEqual({
      label: 'reset edits',
      gesture: null,
    });
  });

  it('names a page change by what changed', () => {
    expect(pageChangeLabel({ orientation: 'landscape' })).toBe('orientation');
    expect(pageChangeLabel({ margins: { top: 0, right: 0, bottom: 0, left: 0 } })).toBe('margins');
  });

  it('says on the buttons what they would do', () => {
    expect(undoButtonLabel('undo', 'zoom')).toBe('Undo: zoom');
    expect(undoButtonLabel('redo', null)).toBe('Nothing to redo');
  });
});
