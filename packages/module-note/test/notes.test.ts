import {
  checkNoteVersion,
  NOTE_BODY_MAX,
  NOTE_TITLE_MAX,
  noteDisplayTitle,
  prepareNoteBody,
  prepareNoteTitle,
} from '../src/domain/notes.js';

describe('prepareNoteTitle', () => {
  it('collapses whitespace, pasted newlines included, and trims', () => {
    expect(prepareNoteTitle('  Opening\n\tchecklist  ')).toEqual({ title: 'Opening checklist' });
  });

  it('allows an empty title — the index falls back to the body', () => {
    expect(prepareNoteTitle('   ')).toEqual({ title: '' });
  });

  it('normalises to NFC, so the same word typed two ways is one title', () => {
    expect(prepareNoteTitle('Café')).toEqual({ title: 'Café' });
  });

  it('⚠ refuses invisible formatting that makes a title read as something else', () => {
    expect(prepareNoteTitle('Payroll‮exe.txt')).toEqual({ refused: 'invalid_title' });
    expect(prepareNoteTitle('Pay​roll')).toEqual({ refused: 'invalid_title' });
  });

  it('counts code points, so emoji are not charged double', () => {
    expect(prepareNoteTitle('😀'.repeat(NOTE_TITLE_MAX))).toEqual({ title: '😀'.repeat(NOTE_TITLE_MAX) });
    expect(prepareNoteTitle('a'.repeat(NOTE_TITLE_MAX + 1))).toEqual({ refused: 'invalid_title' });
  });
});

describe('prepareNoteBody', () => {
  it('keeps Markdown exactly as typed: newlines, indentation, trailing spaces', () => {
    const body = '# Title\n\n  - item  \n\n```\ncode\n```\n';
    expect(prepareNoteBody(body)).toEqual({ body });
  });

  it('⚠ refuses NUL, which Postgres text cannot store', () => {
    expect(prepareNoteBody('a\u0000b')).toEqual({ refused: 'invalid_body' });
  });

  it('refuses a body over the cap', () => {
    expect(prepareNoteBody('a'.repeat(NOTE_BODY_MAX))).toEqual({ body: 'a'.repeat(NOTE_BODY_MAX) });
    expect(prepareNoteBody('a'.repeat(NOTE_BODY_MAX + 1))).toEqual({ refused: 'invalid_body' });
  });
});

describe('noteDisplayTitle', () => {
  it('uses the title when there is one', () => {
    expect(noteDisplayTitle({ title: 'Ideas', body: '# Something else' })).toBe('Ideas');
  });

  it('falls back to the first non-empty body line, without its Markdown marker', () => {
    expect(noteDisplayTitle({ title: '', body: '\n\n## Supplier call\nmore' })).toBe('Supplier call');
    expect(noteDisplayTitle({ title: '', body: '- [ ] buy float' })).toBe('buy float');
    expect(noteDisplayTitle({ title: '', body: '> quoted' })).toBe('quoted');
    expect(noteDisplayTitle({ title: '', body: '1. first' })).toBe('first');
  });

  it('says Untitled when there is nothing to show', () => {
    expect(noteDisplayTitle({ title: '', body: '  \n\n' })).toBe('Untitled');
  });

  it('cuts a long first line with an ellipsis', () => {
    const shown = noteDisplayTitle({ title: '', body: 'x'.repeat(200) });
    expect([...shown]).toHaveLength(80);
    expect(shown.endsWith('…')).toBe(true);
  });
});

describe('checkNoteVersion', () => {
  it('accepts a save based on the current version', () => {
    expect(checkNoteVersion(3, 3)).toBeNull();
  });

  it('refuses a save based on any other version', () => {
    expect(checkNoteVersion(2, 3)).toBe('conflict');
    expect(checkNoteVersion(4, 3)).toBe('conflict');
  });
});
