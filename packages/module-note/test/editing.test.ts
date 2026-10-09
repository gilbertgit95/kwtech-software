import { NOTE_CONFLICT_MESSAGE, NOTE_NOT_FOUND_MESSAGE } from '../src/domain/notes.js';
import { STICKY_TILT_MAX, stickyTilt } from '../src/react/view/appearance.js';
import {
  AUTOSAVE_IDLE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  autosaveDelay,
  copyTitle,
  editPatch,
  type NoteDraft,
  noteOpensIn,
  type OpenNoteState,
  parseTagField,
  planNoteEvent,
  saveFailure,
} from '../src/react/view/editing.js';

const SAVED: NoteDraft = { title: 'T', body: 'B', tags: ['a'], color: 'default' };

describe('editPatch', () => {
  it('is null when nothing changed', () => {
    expect(editPatch(SAVED, { ...SAVED, tags: ['a'] })).toBeNull();
  });

  it('⚠ compares as the server stores — a trailing space or #Tag is not an unsaved change', () => {
    const saved = { ...SAVED, title: 'Hello', tags: ['ops'] };
    expect(editPatch(saved, { ...saved, title: 'Hello ', tags: ['#Ops', 'ops'] })).toBeNull();
  });

  it('⚠ sends only what changed — never a colour somebody else just set', () => {
    expect(editPatch(SAVED, { ...SAVED, body: 'B2' })).toEqual({ body: 'B2' });
    expect(editPatch(SAVED, { ...SAVED, tags: ['a', 'b'], color: 'pink' })).toEqual({
      tags: ['a', 'b'],
      color: 'pink',
    });
  });
});

describe('autosaveDelay', () => {
  it('saves a pause after the last keystroke', () => {
    expect(autosaveDelay(1_000, 1_000, 1_000)).toBe(AUTOSAVE_IDLE_MS);
    expect(autosaveDelay(3_000, 1_000, 1_000)).toBe(0);
  });

  it('⚠ saves at least this often while typing without pause', () => {
    // Typing every second since t=0: the idle deadline keeps moving, the max wait does not.
    expect(autosaveDelay(4_000, 4_000, 0)).toBe(AUTOSAVE_MAX_WAIT_MS - 4_000);
    expect(autosaveDelay(5_000, 5_000, 0)).toBe(0);
  });

  it('never saves more than once per max wait while typing — the throttle bucket is shared', () => {
    let saves = 0;
    let firstUnsaved = 0;
    for (let now = 0; now <= 60_000; now += 250) {
      if (autosaveDelay(now, now, firstUnsaved) === 0) {
        saves += 1;
        firstUnsaved = now + 1;
      }
    }
    expect(saves).toBeLessThanOrEqual(60_000 / AUTOSAVE_MAX_WAIT_MS + 1);
  });
});

describe('planNoteEvent', () => {
  const open = (overrides: Partial<OpenNoteState> = {}): OpenNoteState => ({
    noteId: 'n1',
    version: 3,
    dirty: false,
    saving: false,
    ...overrides,
  });
  const event = (kind: string, noteId: string | null, version: number | null = null) => ({
    kind,
    noteId,
    version,
    actorId: 'someone',
  });

  it('re-reads the index for every event', () => {
    expect(planNoteEvent(event('changed', 'other', 1), open()).index).toBe(true);
  });

  it('checks the open note after a reconnect', () => {
    expect(planNoteEvent(event('sync', null), open())).toEqual({ index: true, open: 'check' });
    expect(planNoteEvent(event('sync', null), open({ noteId: null }))).toEqual({ index: true, open: 'none' });
  });

  it('reloads the open note when nothing on screen would be lost', () => {
    expect(planNoteEvent(event('changed', 'n1', 4), open()).open).toBe('reload');
  });

  it('⚠ never replaces unsaved text — it asks', () => {
    expect(planNoteEvent(event('changed', 'n1', 4), open({ dirty: true })).open).toBe('stale');
  });

  it('ignores an event that is not newer than the screen — our own save coming back', () => {
    expect(planNoteEvent(event('changed', 'n1', 3), open({ dirty: true })).open).toBe('none');
  });

  it('⚠ ignores changes while a save is in flight — its outcome decides', () => {
    expect(planNoteEvent(event('changed', 'n1', 4), open({ saving: true, dirty: true })).open).toBe('none');
  });

  it('says the note is gone when it is deleted or unshared, even mid-save', () => {
    expect(planNoteEvent(event('removed', 'n1'), open({ saving: true })).open).toBe('gone');
  });
});

describe('saveFailure', () => {
  it('recognises the two refusals the editor acts on, by their exact message', () => {
    expect(saveFailure(new Error(NOTE_CONFLICT_MESSAGE))).toBe('conflict');
    expect(saveFailure(new Error(NOTE_NOT_FOUND_MESSAGE))).toBe('gone');
    expect(saveFailure(new Error('Cannot reach the server.'))).toBe('other');
    expect(saveFailure('not an error')).toBe('other');
  });
});

describe('stickyTilt', () => {
  it('leans each note the same way every time, within the limit', () => {
    for (const id of ['a', 'note-1', 'cmg1x9z0000', '']) {
      expect(stickyTilt(id)).toBe(stickyTilt(id));
      expect(Math.abs(stickyTilt(id))).toBeLessThanOrEqual(STICKY_TILT_MAX);
    }
  });

  it('does not lean every note alike', () => {
    const tilts = new Set(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map(stickyTilt));
    expect(tilts.size).toBeGreaterThan(1);
  });
});

describe('small helpers', () => {
  it('names a rescued copy so it is not mistaken for the original', () => {
    expect(copyTitle('Checklist')).toBe('Checklist (my copy)');
    expect(copyTitle('  ')).toBe('Untitled (my copy)');
  });

  it('splits a tag field on commas, dropping empties', () => {
    expect(parseTagField(' ops, , rota ,')).toEqual(['ops', 'rota']);
  });
});

describe('noteOpensIn', () => {
  it('⚠ opens a note with anything in it to be read, never straight into its fields', () => {
    expect(noteOpensIn({ title: 'Prices', body: '' })).toBe('read');
    expect(noteOpensIn({ title: '', body: '- 2 × 2: 60' })).toBe('read');
  });

  it('opens a blank note for writing: there is nothing to read in the one New note just made', () => {
    expect(noteOpensIn({ title: '', body: '' })).toBe('edit');
    expect(noteOpensIn({ title: ' ', body: '\n' })).toBe('edit');
  });
});
