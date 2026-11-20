import { safeLocalPath } from '../src/index.js';

/**
 * The one rule every `?next=` follows (#179). The sign-in page used to check
 * its own copy, which let through values a browser resolves to another host:
 * these cases are the ones that copy missed, beside the ones both refused.
 */
describe('safeLocalPath — a next is followed only as a path on this origin', () => {
  it.each([
    ['a page', '/organizations/o1/billing'],
    ['a page with a query and a fragment', '/organizations/o1/billing/documents/r1?kind=bill&number=B-000001#top'],
    ['an encoded backslash, which a browser keeps as text', '/search?q=%5C'],
    ['the root', '/'],
  ])('keeps %s', (_case, next) => {
    expect(safeLocalPath(next, '/fallback')).toBe(next);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty value', ''],
    ['an absolute URL', 'https://evil.example/signin'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash after the slash, which browsers read as "//"', '/\\evil.example'],
    ['a backslash later on', '/ok/\\evil'],
    ['a tab between the slashes, which browsers strip to "//"', '/\t/evil.example'],
    ['a newline between the slashes', '/\n/evil.example'],
    ['header injection', '/ok\r\nLocation: https://evil.example'],
    ['a bare word, relative to the current page', 'auth/signin'],
    ['a scheme without slashes', 'javascript:alert(1)'],
  ])('falls back for %s', (_case, next) => {
    expect(safeLocalPath(next, '/fallback')).toBe('/fallback');
  });
});
