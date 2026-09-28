import { NOTE_SEARCH_MAX, prepareNoteSearch } from '../src/domain/search.js';
import { NOTE_TAG_MAX, NOTE_TAGS_MAX, normalizeNoteTag, prepareNoteTags } from '../src/domain/tags.js';

describe('normalizeNoteTag', () => {
  it('drops a leading #, lower-cases, and joins words with a hyphen', () => {
    expect(normalizeNoteTag('  #Opening Checklist ')).toBe('opening-checklist');
  });

  it('is null for a tag that is nothing once normalised', () => {
    expect(normalizeNoteTag(' # ')).toBeNull();
  });
});

describe('prepareNoteTags', () => {
  it('drops empties and duplicates, keeping the order typed', () => {
    expect(prepareNoteTags(['Ops', '', '#daily', 'ops', ' '])).toEqual({ tags: ['ops', 'daily'] });
  });

  it('refuses too many tags', () => {
    const many = Array.from({ length: NOTE_TAGS_MAX + 1 }, (_, index) => `t${index}`);
    expect(prepareNoteTags(many)).toEqual({ refused: 'invalid_tags' });
  });

  it('counts tags AFTER dropping duplicates', () => {
    const repeated = Array.from({ length: NOTE_TAGS_MAX + 5 }, () => 'same');
    expect(prepareNoteTags(repeated)).toEqual({ tags: ['same'] });
  });

  it('refuses a tag that is too long or carries invisible characters', () => {
    expect(prepareNoteTags(['a'.repeat(NOTE_TAG_MAX + 1)])).toEqual({ refused: 'invalid_tags' });
    expect(prepareNoteTags(['ops\u200B'])).toEqual({ refused: 'invalid_tags' });
  });
});

describe('prepareNoteSearch', () => {
  it('is null for nothing to search', () => {
    expect(prepareNoteSearch(undefined)).toBeNull();
    expect(prepareNoteSearch('   ')).toBeNull();
  });

  it('collapses whitespace and cuts, rather than refusing, a long term', () => {
    expect(prepareNoteSearch('  till   float ')).toBe('till float');
    expect([...(prepareNoteSearch('a'.repeat(500)) ?? '')]).toHaveLength(NOTE_SEARCH_MAX);
  });
});
