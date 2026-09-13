import {
  boardNickname,
  canClearNickname,
  canSetNickname,
  MAX_NICKNAME_CODE_POINTS,
  prepareNickname,
} from '../src/domain/nicknames.js';

describe('prepareNickname', () => {
  it('accepts up to 24 characters, counted as code points', () => {
    expect(MAX_NICKNAME_CODE_POINTS).toBe(24);
    expect(prepareNickname(' Ate Joy ')).toEqual({ text: 'Ate Joy' });
    expect(prepareNickname('🙂'.repeat(24))).toEqual({ text: '🙂'.repeat(24) });
    expect(prepareNickname('x'.repeat(25))).toEqual({ refused: 'too_long' });
  });

  it('refuses invisible characters on a public screen', () => {
    expect(prepareNickname('Joy​')).toEqual({ refused: 'invisible_characters' });
  });
});

describe('boardNickname', () => {
  it('⚠ shows NO name for somebody with no nickname — never a fallback to their account name', () => {
    expect(boardNickname(true, null)).toBeNull();
    expect(boardNickname(true, undefined)).toBeNull();
    expect(boardNickname(true, '')).toBeNull();
  });

  it('shows the nickname only while the workspace shows names', () => {
    expect(boardNickname(true, 'Ate Joy')).toBe('Ate Joy');
    expect(boardNickname(false, 'Ate Joy')).toBeNull();
  });

  it('⚠ cannot be handed an account name, because it takes none', () => {
    expect(boardNickname.length).toBe(2);
  });
});

describe('who may change a nickname', () => {
  it('lets only the person set their own', () => {
    expect(canSetNickname('joy', 'joy')).toBe(true);
    expect(canSetNickname('boss', 'joy')).toBe(false);
  });

  it('lets queue:manage_windows CLEAR one, never set one', () => {
    expect(canClearNickname('boss', 'joy', true)).toBe(true);
    expect(canClearNickname('boss', 'joy', false)).toBe(false);
    expect(canClearNickname('joy', 'joy', false)).toBe(true);
    expect(canSetNickname('boss', 'joy')).toBe(false);
  });
});
