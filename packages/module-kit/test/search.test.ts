import { escapeLikePattern } from '../src/index.js';

describe('escapeLikePattern', () => {
  it('⚠ makes % and _ literal, so 100% does not match everything after 100', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
  });

  it('escapes the backslash first, so the added escapes are not escaped again', () => {
    expect(escapeLikePattern('C:\\temp_1')).toBe('C:\\\\temp\\_1');
  });
});
