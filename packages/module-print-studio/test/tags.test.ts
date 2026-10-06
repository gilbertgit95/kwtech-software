import {
  groupByStudioTag,
  matchStudioTags,
  prepareLayoutTag,
  STUDIO_LAYOUT_TAG_MAX,
  studioTagKey,
  studioTagSuggestions,
} from '../src/domain/tags.js';

describe('prepareLayoutTag', () => {
  it('tidies a tag to one clean line', () => {
    expect(prepareLayoutTag('  Photo   Print ')).toEqual({ tag: 'Photo Print' });
    expect(prepareLayoutTag('ID')).toEqual({ tag: 'ID' });
  });

  it('reads nothing and an empty line alike as no tag', () => {
    expect(prepareLayoutTag(null)).toEqual({ tag: null });
    expect(prepareLayoutTag(undefined)).toEqual({ tag: null });
    expect(prepareLayoutTag('   ')).toEqual({ tag: null });
  });

  it('refuses a tag that is too long, or not text', () => {
    expect(prepareLayoutTag('x'.repeat(STUDIO_LAYOUT_TAG_MAX))).toEqual({ tag: 'x'.repeat(STUDIO_LAYOUT_TAG_MAX) });
    expect(prepareLayoutTag('x'.repeat(STUDIO_LAYOUT_TAG_MAX + 1))).toEqual({ refused: 'invalid_tag' });
    expect(prepareLayoutTag(7)).toEqual({ refused: 'invalid_tag' });
  });
});

describe('grouping by tag', () => {
  const layout = (name: string, tag: string | null) => ({ name, tag });

  it('⚠ compares tags without case or spacing, so two spellings are one shelf', () => {
    expect(studioTagKey(' Photo  PRINT ')).toBe('photo print');
    expect(studioTagKey('')).toBeNull();
    const groups = groupByStudioTag(
      [layout('a', 'ID'), layout('b', 'id '), layout('c', 'Photo Print')],
      (one) => one.tag,
    );
    expect(groups.map((group) => [group.label, group.items.map((one) => one.name)])).toEqual([
      ['ID', ['a', 'b']],
      ['Photo Print', ['c']],
    ]);
  });

  it('puts tags in alphabetical order and the untagged last, keeping the order inside a group', () => {
    const groups = groupByStudioTag(
      [layout('loose', null), layout('p', 'Photo Print'), layout('i2', 'ID'), layout('i1', 'ID'), layout('bare', '')],
      (one) => one.tag,
    );
    expect(groups.map((group) => [group.label, group.items.map((one) => one.name)])).toEqual([
      ['ID', ['i2', 'i1']],
      ['Photo Print', ['p']],
      [null, ['loose', 'bare']],
    ]);
    expect(groupByStudioTag([], () => null)).toEqual([]);
  });

  it('narrows the offered tags as one is typed, and says when the typed one is new', () => {
    const tags = ['ID', 'Photo Print', 'Stickers'];
    expect(matchStudioTags(tags, '')).toEqual({ matches: tags, isNew: false });
    expect(matchStudioTags(tags, 'ph')).toEqual({ matches: ['Photo Print'], isNew: true });
    expect(matchStudioTags(tags, ' photo  print ')).toEqual({ matches: ['Photo Print'], isNew: false });
    expect(matchStudioTags(tags, 'Mugs')).toEqual({ matches: [], isNew: true });
  });

  it('offers the presets’ tags, then the ones in use, each once', () => {
    expect(studioTagSuggestions(['Stickers', 'id', null, 'stickers'])).toEqual([
      'ID',
      'Photo Print',
      'Page Grid',
      'Stickers',
    ]);
  });
});
