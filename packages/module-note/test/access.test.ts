import {
  canSeeNote,
  checkEditNote,
  checkPinNote,
  checkShareNote,
  planNoteBinAct,
  shouldKeepRevision,
} from '../src/domain/access.js';
import type { NoteAccessFacts } from '../src/types.js';

const AUTHOR = 'user-author';
const OTHER = 'user-other';
const TRASHED_AT = new Date('2026-09-28T10:00:00Z');

function note(overrides: Partial<NoteAccessFacts> = {}): NoteAccessFacts {
  return { authorId: AUTHOR, visibility: 'private', trashedAt: null, ...overrides };
}

describe('canSeeNote', () => {
  it('shows a private note to its author and nobody else', () => {
    expect(canSeeNote(note(), AUTHOR)).toBe(true);
    expect(canSeeNote(note(), OTHER)).toBe(false);
  });

  it('shows a shared note to everybody the guard let in', () => {
    expect(canSeeNote(note({ visibility: 'workspace' }), OTHER)).toBe(true);
  });
});

/**
 * ⚠ THE ORACLE. For somebody else's private note, every check must answer
 * exactly `not_found` — the answer a note that does not exist gets — whatever
 * else is true of it. Any other reason confirms the note exists.
 */
describe('someone else’s private note is indistinguishable from no note', () => {
  const hidden = [note(), note({ trashedAt: TRASHED_AT })];

  it.each(hidden)('edit, share and pin all answer not_found', (facts) => {
    expect(checkEditNote(facts, OTHER)).toBe('not_found');
    expect(checkShareNote(facts, OTHER)).toBe('not_found');
    expect(checkPinNote(facts, OTHER)).toBe('not_found');
  });

  it.each(['trash', 'restore', 'delete_forever'] as const)('%s answers not_found, never needs_manage_all', (act) => {
    for (const facts of hidden) {
      expect(planNoteBinAct(facts, OTHER, act)).toEqual({ kind: 'refused', reason: 'not_found' });
    }
  });
});

describe('checkEditNote', () => {
  it('lets the author edit their own note', () => {
    expect(checkEditNote(note(), AUTHOR)).toBeNull();
  });

  it('lets anybody who can see a shared note edit it', () => {
    expect(checkEditNote(note({ visibility: 'workspace' }), OTHER)).toBeNull();
  });

  it('refuses an edit to a note in the trash — restore it first', () => {
    expect(checkEditNote(note({ trashedAt: TRASHED_AT }), AUTHOR)).toBe('in_trash');
    expect(checkEditNote(note({ visibility: 'workspace', trashedAt: TRASHED_AT }), OTHER)).toBe('in_trash');
  });
});

describe('checkShareNote', () => {
  it('lets the author share and unshare', () => {
    expect(checkShareNote(note(), AUTHOR)).toBeNull();
    expect(checkShareNote(note({ visibility: 'workspace' }), AUTHOR)).toBeNull();
  });

  it('⚠ refuses everyone else, even on a shared note they may edit', () => {
    expect(checkShareNote(note({ visibility: 'workspace' }), OTHER)).toBe('not_author');
  });

  it('refuses while the note is in the trash', () => {
    expect(checkShareNote(note({ trashedAt: TRASHED_AT }), AUTHOR)).toBe('in_trash');
  });
});

describe('checkPinNote', () => {
  it('lets whoever can see a note pin it, trashed or not', () => {
    expect(checkPinNote(note({ visibility: 'workspace' }), OTHER)).toBeNull();
    expect(checkPinNote(note({ trashedAt: TRASHED_AT }), AUTHOR)).toBeNull();
  });
});

describe('planNoteBinAct', () => {
  it('lets the author trash, restore and delete forever their own note', () => {
    expect(planNoteBinAct(note(), AUTHOR, 'trash')).toEqual({ kind: 'allowed' });
    expect(planNoteBinAct(note({ trashedAt: TRASHED_AT }), AUTHOR, 'restore')).toEqual({ kind: 'allowed' });
    expect(planNoteBinAct(note({ trashedAt: TRASHED_AT }), AUTHOR, 'delete_forever')).toEqual({ kind: 'allowed' });
  });

  it('defers somebody else’s SHARED note to manage_all', () => {
    const shared = note({ visibility: 'workspace' });
    expect(planNoteBinAct(shared, OTHER, 'trash')).toEqual({ kind: 'needs_manage_all' });
    expect(planNoteBinAct({ ...shared, trashedAt: TRASHED_AT }, OTHER, 'restore')).toEqual({
      kind: 'needs_manage_all',
    });
  });

  it('⚠ deletes forever only from the trash', () => {
    expect(planNoteBinAct(note(), AUTHOR, 'delete_forever')).toEqual({ kind: 'refused', reason: 'not_in_trash' });
  });

  it('refuses to trash what is already in the trash, or restore what is not', () => {
    expect(planNoteBinAct(note({ trashedAt: TRASHED_AT }), AUTHOR, 'trash')).toEqual({
      kind: 'refused',
      reason: 'in_trash',
    });
    expect(planNoteBinAct(note(), AUTHOR, 'restore')).toEqual({ kind: 'refused', reason: 'not_in_trash' });
  });

  it('answers the state refusal before asking for manage_all — no port call for a doomed act', () => {
    expect(planNoteBinAct(note({ visibility: 'workspace' }), OTHER, 'delete_forever')).toEqual({
      kind: 'refused',
      reason: 'not_in_trash',
    });
  });
});

describe('shouldKeepRevision', () => {
  it('keeps one when somebody else saves over a shared note', () => {
    expect(shouldKeepRevision({ visibility: 'workspace', updatedById: AUTHOR }, OTHER)).toBe(true);
  });

  it('keeps none for the same person autosaving their own typing', () => {
    expect(shouldKeepRevision({ visibility: 'workspace', updatedById: OTHER }, OTHER)).toBe(false);
  });

  it('keeps none for a private note — only its author can write it', () => {
    expect(shouldKeepRevision({ visibility: 'private', updatedById: OTHER }, AUTHOR)).toBe(false);
  });
});
