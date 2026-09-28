import { adjacentNote, choiceAfterOpening, noteIndexLayout } from '../src/react/view/layout.js';

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
