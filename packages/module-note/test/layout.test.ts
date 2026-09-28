import { choiceAfterOpening, noteIndexLayout } from '../src/react/view/layout.js';

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
