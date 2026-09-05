import { FEATURE_REGISTRY } from '../src/feature-keys.js';
import {
  draftsToRegistrySource,
  draftToSpec,
  EMPTY_DRAFT,
  type FeatureDraft,
  hasErrors,
  importTemplateCsv,
  parseDelimited,
  parseTags,
  rowsToDrafts,
  specToDraft,
  validateDraft,
  validateDraftList,
} from '../src/index.js';

const valid: FeatureDraft = {
  key: 'reports:read',
  module: 'reports',
  level: 'organization',
  label: 'View reports',
  description: 'Read the reporting section.',
  isPrivileged: false,
  tags: '',
};

describe('validateDraft', () => {
  it('accepts a well-formed draft', () => {
    expect(validateDraft(valid)).toEqual({});
  });

  it('reports every problem at once, not just the first', () => {
    const errors = validateDraft(EMPTY_DRAFT);
    expect(Object.keys(errors).sort()).toEqual(['description', 'key', 'label', 'module']);
  });

  it.each([
    ['no colon', 'reportsread'],
    ['upper case', 'Reports:Read'],
    ['leading digit', '1reports:read'],
    ['empty half', 'reports:'],
    ['a space', 'reports:read all'],
  ])('rejects a key with %s', (_why, key) => {
    expect(validateDraft({ ...valid, key }).key).toBeDefined();
  });

  it.each(['admin:access', 'platform:support_access', 'workspaces:access_all'])(
    'accepts %s, which the registry already uses',
    (key) => {
      expect(validateDraft({ ...valid, key }).key).toBeUndefined();
    },
  );

  /** Two definitions of one key is the ambiguity the registry exists to prevent. */
  it('rejects a key that already exists', () => {
    expect(validateDraft(valid, { existingKeys: ['reports:read'] }).key).toContain('already exists');
  });

  it('lets an edit keep its own key', () => {
    expect(validateDraft(valid, { existingKeys: ['reports:read'], originalKey: 'reports:read' }).key).toBeUndefined();
  });

  it('rejects an unknown level', () => {
    expect(validateDraft({ ...valid, level: 'tenant' }).level).toBeDefined();
  });

  /** It is what a role editor shows before someone hands over a right. */
  it('requires a description', () => {
    expect(validateDraft({ ...valid, description: '   ' }).description).toBeDefined();
  });
});

describe('draftToSpec', () => {
  it('trims and drops isPrivileged when false', () => {
    const spec = draftToSpec({ ...valid, key: '  reports:read  ', label: ' View ' });
    expect(spec.key).toBe('reports:read');
    expect(spec.label).toBe('View');
    expect(spec).not.toHaveProperty('isPrivileged');
  });

  it('keeps isPrivileged when true', () => {
    expect(draftToSpec({ ...valid, isPrivileged: true }).isPrivileged).toBe(true);
  });

  /** A binding names where a key is ENFORCED; a feature typed into a form has none yet. */
  it('emits no bindings', () => {
    expect(draftToSpec(valid).bindings).toEqual([]);
  });

  it('round-trips through specToDraft', () => {
    for (const spec of FEATURE_REGISTRY) {
      const back = draftToSpec(specToDraft(spec));
      expect(back.key).toBe(spec.key);
      expect(back.level).toBe(spec.level);
      expect(back.isPrivileged ?? false).toBe(spec.isPrivileged ?? false);
    }
  });
});

describe('draftsToRegistrySource', () => {
  it('emits a pasteable entry', () => {
    const source = draftsToRegistrySource([valid]);
    expect(source).toContain("key: 'reports:read',");
    expect(source).toContain("level: 'organization',");
    expect(source).toContain('bindings: [],');
  });

  /** A description with an apostrophe must not break the literal it lands in. */
  it('escapes a single quote', () => {
    const source = draftsToRegistrySource([{ ...valid, description: "The owner's report." }]);
    expect(source).toContain("The owner\\'s report.");
  });
});

describe('parseDelimited', () => {
  it('parses a simple file', () => {
    expect(parseDelimited('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quoted fields containing the delimiter', () => {
    expect(parseDelimited('a,b\n"one, two",3')).toEqual([
      ['a', 'b'],
      ['one, two', '3'],
    ]);
  });

  it('handles a doubled quote as one literal quote', () => {
    expect(parseDelimited('a\n"say ""hi"""')).toEqual([['a'], ['say "hi"']]);
  });

  /** Without normalising CRLF, every last field keeps a trailing \r — invisible and fatal to a key match. */
  it('normalises CRLF', () => {
    expect(parseDelimited('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles a newline inside a quoted field', () => {
    expect(parseDelimited('a\n"line\nbreak"')).toEqual([['a'], ['line\nbreak']]);
  });

  it('supports tabs', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('rowsToDrafts', () => {
  const header = ['key', 'module', 'level', 'label', 'description', 'isPrivileged'];
  const row = (key: string) => [key, 'reports', 'organization', 'Label', 'A description.', 'false'];

  it('is fatal on an empty file', () => {
    expect(rowsToDrafts([], []).fatal).toBeDefined();
  });

  it('is fatal on a header with no rows', () => {
    expect(rowsToDrafts([header], []).fatal).toBeDefined();
  });

  it('names the missing columns', () => {
    expect(rowsToDrafts([['key', 'label']], []).fatal).toContain('module');
  });

  /** isPrivileged absent means "none of these are privileged", not a broken file. */
  it('accepts a file without the optional column', () => {
    const result = rowsToDrafts([['key', 'module', 'level', 'label', 'description'], row('a:b').slice(0, 5)], []);
    expect(result.fatal).toBeUndefined();
    expect(result.rows[0]?.draft.isPrivileged).toBe(false);
  });

  /** A file handed to a person comes back with "Key" and "Is Privileged". */
  it('matches headers case- and space-insensitively', () => {
    const result = rowsToDrafts([['Key', 'Module', 'Level', 'Label', 'Description', 'Is Privileged'], row('a:b')], []);
    expect(result.fatal).toBeUndefined();
    expect(result.rows[0]?.draft.key).toBe('a:b');
  });

  it.each([['true'], ['TRUE'], ['yes'], ['1'], ['x']])('reads %s as privileged', (value) => {
    const result = rowsToDrafts([header, [...row('a:b').slice(0, 5), value]], []);
    expect(result.rows[0]?.draft.isPrivileged).toBe(true);
  });

  it('skips blank lines rather than failing them', () => {
    const result = rowsToDrafts([header, row('a:b'), ['', '', '', '', '', '']], []);
    expect(result.rows).toHaveLength(1);
  });

  /** Line numbers are what someone scrolls to: +1 for the header, +1 for counting from one. */
  it('reports the source line number', () => {
    const result = rowsToDrafts([header, row('a:b'), row('c:d')], []);
    expect(result.rows.map((r) => r.line)).toEqual([2, 3]);
  });

  it('validates every row rather than stopping at the first failure', () => {
    const result = rowsToDrafts([header, row('BAD KEY'), row('also bad'), row('c:d')], []);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.filter((r) => hasErrors(r.errors))).toHaveLength(2);
  });

  /** Both rows would otherwise pass, and composeFeatures would throw at boot. */
  it('catches a key duplicated within the file', () => {
    const result = rowsToDrafts([header, row('a:b'), row('a:b')], []);
    expect(hasErrors(result.rows[0]?.errors ?? {})).toBe(false);
    expect(result.rows[1]?.errors.key).toContain('already exists');
  });

  it('catches a key that already exists in the registry', () => {
    const result = rowsToDrafts([header, row('admin:access')], ['admin:access']);
    expect(result.rows[0]?.errors.key).toContain('already exists');
  });
});

/** The template is generated from IMPORT_COLUMNS, so it cannot drift from the parser. */
describe('importTemplateCsv', () => {
  it('parses back into valid drafts', () => {
    const result = rowsToDrafts(parseDelimited(importTemplateCsv()), []);
    expect(result.fatal).toBeUndefined();
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => !hasErrors(r.errors))).toBe(true);
  });
});

/**
 * The staging grid revalidates the whole list on every edit, so these are the
 * rules it enforces live — and the same ones the file import applies.
 */
describe('validateDraftList', () => {
  const draft = (key: string): FeatureDraft => ({
    key,
    module: 'reports',
    level: 'organization',
    label: 'Label',
    description: 'A description.',
    isPrivileged: false,
    tags: '',
  });

  it('returns one result per draft, in order', () => {
    expect(validateDraftList([draft('a:b'), draft('c:d')])).toHaveLength(2);
  });

  it('passes a clean list', () => {
    expect(validateDraftList([draft('a:b'), draft('c:d')]).every((e) => !hasErrors(e))).toBe(true);
  });

  /** The FIRST occurrence is where the key legitimately lives; the second is the mistake. */
  it('flags the second use of a duplicated key, not the first', () => {
    const [first, second] = validateDraftList([draft('a:b'), draft('a:b')]);
    expect(hasErrors(first ?? {})).toBe(false);
    expect(second?.key).toContain('already exists');
  });

  it('flags a key that collides with the existing registry', () => {
    expect(validateDraftList([draft('admin:access')], ['admin:access'])[0]?.key).toContain('already exists');
  });

  /**
   * A malformed key is not a name anyone could collide with. Claiming it would
   * report the same problem twice, on two different rows.
   */
  it('does not let a malformed key claim a slot', () => {
    const results = validateDraftList([draft('BAD KEY'), draft('BAD KEY')]);
    expect(results[0]?.key).not.toContain('already exists');
    expect(results[1]?.key).not.toContain('already exists');
  });

  it('reports field errors independently per row', () => {
    const results = validateDraftList([draft('a:b'), { ...draft('c:d'), label: '' }]);
    expect(hasErrors(results[0] ?? {})).toBe(false);
    expect(results[1]?.label).toBeDefined();
  });

  /** A blank row added by "Add row" is invalid until filled — never silently accepted. */
  it('rejects an empty draft', () => {
    expect(hasErrors(validateDraftList([EMPTY_DRAFT])[0] ?? {})).toBe(true);
  });

  it('is empty for an empty list', () => {
    expect(validateDraftList([])).toEqual([]);
  });
});

/**
 * Tags group; they never grant. The vocabulary is closed so a filter collapses
 * a long list into a few piles rather than into many spellings of one pile.
 */
describe('tags', () => {
  it('accepts a known tag', () => {
    expect(validateDraft({ ...valid, tags: 'admin' }).tags).toBeUndefined();
  });

  it('accepts several, in any spelling', () => {
    expect(validateDraft({ ...valid, tags: 'Admin, Access Control' }).tags).toBeUndefined();
  });

  it('refuses an unknown tag rather than silently keeping it', () => {
    expect(validateDraft({ ...valid, tags: 'admin, nonsense' }).tags).toContain('nonsense');
  });

  it('treats an empty field as no tags', () => {
    expect(validateDraft({ ...valid, tags: '  ,  ' }).tags).toBeUndefined();
    expect(draftToSpec({ ...valid, tags: '  ,  ' }).tags).toEqual([]);
  });

  it('normalises case, spacing and duplicates', () => {
    expect(parseTags('Admin,  ADMIN , Access Control')).toEqual(['access-control', 'admin']);
  });

  it('round-trips through specToDraft', () => {
    expect(specToDraft(draftToSpec({ ...valid, tags: 'billing, admin' })).tags).toBe('admin, billing');
  });

  it('emits a tags line in the registry source', () => {
    expect(draftsToRegistrySource([{ ...valid, tags: 'admin' }])).toContain("tags: ['admin'],");
  });

  it('omits the tags line when there are none', () => {
    expect(draftsToRegistrySource([{ ...valid, tags: '' }])).not.toContain('tags:');
  });
});
