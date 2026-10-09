import {
  adjacentNote,
  choiceAfterOpening,
  dropResult,
  keyboardMove,
  noteIndexLayout,
  noteToOpenOnLoad,
} from '../src/react/view/layout.js';

describe('noteIndexLayout', () => {
  it('puts the list beside the note when wide, until it is collapsed', () => {
    expect(noteIndexLayout({ narrow: false, noteOpen: true, choice: null })).toBe('beside');
    expect(noteIndexLayout({ narrow: false, noteOpen: true, choice: false })).toBe('hidden');
    expect(noteIndexLayout({ narrow: false, noteOpen: false, choice: false })).toBe('hidden');
  });

  it('⚠ keeps the list reachable when narrow — collapsed by default, slid over the note when expanded', () => {
    expect(noteIndexLayout({ narrow: true, noteOpen: true, choice: null })).toBe('hidden');
    expect(noteIndexLayout({ narrow: true, noteOpen: true, choice: true })).toBe('overlay');
  });

  it('fills a narrow box when no note is open', () => {
    expect(noteIndexLayout({ narrow: true, noteOpen: false, choice: null })).toBe('full');
  });
});

describe('choiceAfterOpening', () => {
  it('gets the narrow overlay out of the way once a note is picked', () => {
    expect(noteIndexLayout({ narrow: true, noteOpen: true, choice: choiceAfterOpening(true, true) })).toBe('hidden');
  });

  it('keeps the person’s choice when wide', () => {
    expect(choiceAfterOpening(false, false)).toBe(false);
    expect(choiceAfterOpening(false, null)).toBeNull();
  });
});

describe('adjacentNote', () => {
  const list = [{ id: 'pinned' }, { id: 'a' }, { id: 'b' }];

  it('turns to the note before and after, pinned first', () => {
    expect(adjacentNote(list, 'a', 'previous', false)).toEqual({ id: 'pinned' });
    expect(adjacentNote(list, 'a', 'next', false)).toEqual({ id: 'b' });
  });

  it('has nothing before the first note, or after the very last', () => {
    expect(adjacentNote(list, 'pinned', 'previous', false)).toBeNull();
    expect(adjacentNote(list, 'b', 'next', false)).toBeNull();
  });

  it('asks for the next page at the last loaded note when there is more', () => {
    expect(adjacentNote(list, 'b', 'next', true)).toBe('load_more');
  });

  it('starts from the top when the open note left the list', () => {
    expect(adjacentNote(list, 'gone', 'next', true)).toEqual({ id: 'pinned' });
    expect(adjacentNote(list, 'gone', 'previous', true)).toBeNull();
  });
});

describe('dropResult and keyboardMove', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('moves a note down onto another, and names what it now follows', () => {
    expect(dropResult(ids, 'a', 'c')).toEqual({ ids: ['b', 'c', 'a', 'd'], afterId: 'c' });
  });

  it('moves a note up to the top of the section, following nothing', () => {
    expect(dropResult(ids, 'c', 'a')).toEqual({ ids: ['c', 'a', 'b', 'd'], afterId: null });
  });

  it('is null when nothing moved', () => {
    expect(dropResult(ids, 'a', 'a')).toBeNull();
    expect(dropResult(ids, 'a', 'gone')).toBeNull();
  });

  it('moves one place from the keyboard, and not past either end', () => {
    expect(keyboardMove(ids, 'b', 1)).toEqual({ ids: ['a', 'c', 'b', 'd'], afterId: 'c' });
    expect(keyboardMove(ids, 'b', -1)).toEqual({ ids: ['b', 'a', 'c', 'd'], afterId: null });
    expect(keyboardMove(ids, 'a', -1)).toBeNull();
    expect(keyboardMove(ids, 'd', 1)).toBeNull();
  });
});

describe('noteToOpenOnLoad', () => {
  const ordered = [{ id: 'pinned' }, { id: 'second' }];

  it('opens the first note of the list, pinned first', () => {
    expect(noteToOpenOnLoad({ ordered, openId: null, narrow: false })).toBe('pinned');
  });

  it('opens nothing when there are no notes, or one is open already', () => {
    expect(noteToOpenOnLoad({ ordered: [], openId: null, narrow: false })).toBeNull();
    expect(noteToOpenOnLoad({ ordered, openId: 'second', narrow: false })).toBeNull();
  });

  it('⚠ opens nothing in a narrow box, where an open note would hide the list before it was seen', () => {
    expect(noteToOpenOnLoad({ ordered, openId: null, narrow: true })).toBeNull();
  });
});
