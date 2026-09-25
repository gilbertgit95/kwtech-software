import { checkHref, NOTIFICATION_MAX_ACTIONS, prepareActions, readActions } from '../src/domain/actions.js';

const strict = { allowHttp: false };

describe('checkHref — what a button may point at', () => {
  it.each(['/queue', '/files/1?download=1', 'https://example.com/report.pdf'])('accepts %s', (href) => {
    expect(checkHref(href, strict)).toBeNull();
  });

  it.each([
    ['//evil.example', 'a protocol-relative URL, which starts with a slash and leaves the site'],
    ['/\\evil.example', 'a backslash, which browsers turn into the same thing'],
    ['javascript:alert(1)', 'script'],
    ['JAVASCRIPT:alert(1)', 'script, in capitals'],
    ['data:text/html,<b>x</b>', 'a data URL'],
    ['/queue\n', 'a control character'],
    ['/que ue', 'whitespace, where parsers disagree'],
    ['ftp://example.com', 'another scheme'],
  ])('⚠ refuses %s (%s)', (href) => {
    expect(checkHref(href, strict)).toBe('unsafe');
  });

  it('accepts plain http only when the policy allows it (development)', () => {
    expect(checkHref('http://localhost:8081/x', strict)).toBe('unsafe');
    expect(checkHref('http://localhost:8081/x', { allowHttp: true })).toBeNull();
  });

  it('refuses an empty href and an absurdly long one', () => {
    expect(checkHref('', strict)).toBe('empty');
    expect(checkHref(`/${'a'.repeat(2001)}`, strict)).toBe('too_long');
  });
});

describe('prepareActions — buttons on the way in', () => {
  it('normalises a link and forces an external one into a new tab', () => {
    const result = prepareActions(
      [
        { kind: 'link', key: 'open', label: 'Open', href: '/queue', target: 'self' },
        { kind: 'link', key: 'docs', label: 'Docs', href: 'https://example.com', target: 'self' },
      ],
      strict,
    );
    expect(result).toEqual({
      actions: [
        { kind: 'link', key: 'open', label: 'Open', href: '/queue', target: 'self' },
        { kind: 'link', key: 'docs', label: 'Docs', href: 'https://example.com', target: 'blank' },
      ],
    });
  });

  it('keeps a download filename only when it is a plain name, never a path', () => {
    const result = prepareActions(
      [
        { kind: 'download', key: 'a', label: 'Report', href: '/r.pdf', filename: 'report.pdf' },
        { kind: 'download', key: 'b', label: 'Other', href: '/o.pdf', filename: '../../etc/passwd' },
      ],
      strict,
    );
    expect('actions' in result ? result.actions : null).toEqual([
      { kind: 'download', key: 'a', label: 'Report', href: '/r.pdf', filename: 'report.pdf' },
      { kind: 'download', key: 'b', label: 'Other', href: '/o.pdf' },
    ]);
  });

  it(`refuses more than ${NOTIFICATION_MAX_ACTIONS} buttons`, () => {
    const one = { kind: 'link', key: 'k', label: 'L', href: '/x', target: 'self' };
    const four = [1, 2, 3, 4].map((n) => ({ ...one, key: `k${n}` }));
    expect(prepareActions(four, strict)).toEqual({ refused: expect.stringContaining('at most 3') });
  });

  it('refuses two buttons with one key, an unknown kind, and an unsafe link', () => {
    const link = { kind: 'link', key: 'same', label: 'A', href: '/a', target: 'self' };
    expect('refused' in prepareActions([link, { ...link, label: 'B' }], strict)).toBe(true);
    expect('refused' in prepareActions([{ ...link, kind: 'command' }], strict)).toBe(true);
    expect('refused' in prepareActions([{ ...link, href: 'javascript:void(0)' }], strict)).toBe(true);
  });
});

describe('readActions — buttons on the way out', () => {
  it('⚠ drops a bad button rather than throwing, so one bad row cannot break a list', () => {
    const stored = [
      { kind: 'link', key: 'ok', label: 'Fine', href: '/fine', target: 'self' },
      { kind: 'link', key: 'bad', label: 'Evil', href: 'javascript:alert(1)', target: 'self' },
      'not even an object',
    ];
    expect(readActions(stored, strict)).toEqual([
      { kind: 'link', key: 'ok', label: 'Fine', href: '/fine', target: 'self' },
    ]);
  });

  it('treats a column that is not a list as no buttons', () => {
    expect(readActions({ oops: true }, strict)).toEqual([]);
    expect(readActions(null, strict)).toEqual([]);
  });
});
