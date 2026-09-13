import {
  ALL_EMOJI,
  EMOJI_GROUPS,
  insertEmoji,
  isPlausibleEmoji,
  MAX_RECENT_EMOJI,
  withRecentEmoji,
} from '../src/react/emoji.js';

/**
 * ── THE EMOJI PICKER'S RULES ───────────────────────────────────────────────
 *
 * The component cannot be rendered here — nothing in this repo runs a browser —
 * so everything that can be a pure function is one, and this is where they are
 * checked. The ten lines left inside the component are the ones that genuinely
 * need a textarea.
 */

describe('insertEmoji', () => {
  /**
   * ⚠ THE WHOLE POINT. A naive picker appends to the end, which moves somebody's
   * cursor without asking every time they pick one mid-sentence.
   */
  it('⚠ inserts at the caret rather than at the end', () => {
    expect(insertEmoji('hello world', '👋', { start: 5, end: 5 })).toEqual({
      text: 'hello👋 world',
      caret: 5 + '👋'.length,
    });
  });

  it('replaces a selection rather than inserting beside it', () => {
    expect(insertEmoji('hello world', '👋', { start: 0, end: 5 })).toEqual({
      text: '👋 world',
      caret: '👋'.length,
    });
  });

  it('appends at the end, which is where an empty box puts the caret', () => {
    expect(insertEmoji('', '🎉', { start: 0, end: 0 })).toEqual({ text: '🎉', caret: '🎉'.length });
  });

  /**
   * ⚠ THE CARET IS IN UTF-16 UNITS, not code points — that is what
   * `selectionStart` and `setSelectionRange` speak. A thumbs-up is two units, so
   * inserting after one must land at 2, not at 1. Getting this wrong puts an
   * emoji INSIDE a previous one and produces a broken glyph.
   */
  it('⚠ counts the caret in UTF-16 units, so it never lands inside an emoji', () => {
    const after = insertEmoji('👍', '🎉', { start: '👍'.length, end: '👍'.length });

    expect(after.text).toBe('👍🎉');
    expect(after.caret).toBe('👍🎉'.length);
    // And the result is still two whole emoji, not three broken halves.
    expect([...after.text]).toHaveLength(2);
  });

  it('clamps a selection that is out of range rather than producing nonsense', () => {
    expect(insertEmoji('hi', '👋', { start: 99, end: 99 }).text).toBe('hi👋');
    expect(insertEmoji('hi', '👋', { start: -5, end: -5 }).text).toBe('👋hi');
  });
});

describe('isPlausibleEmoji', () => {
  it('accepts the emoji this build ships, including sequences and modifiers', () => {
    for (const emoji of ALL_EMOJI) expect(isPlausibleEmoji(emoji)).toBe(true);
    // A four-person ZWJ family is seven code points — the reason the cap is not 1.
    expect(isPlausibleEmoji('👨‍👩‍👧‍👦')).toBe(true);
    expect(isPlausibleEmoji('👍🏽')).toBe(true);
  });

  /**
   * ⚠ THE REASON THIS EXISTS. The quick button's value comes out of
   * `localStorage`, which a person can edit by hand, and one tap SENDS it. An
   * unbounded value there is an arbitrary message body one tap away.
   */
  it('⚠ refuses anything long enough to be a message rather than an emoji', () => {
    expect(isPlausibleEmoji('this is a whole sentence somebody typed in')).toBe(false);
    expect(isPlausibleEmoji('👍'.repeat(20))).toBe(false);
  });

  it('refuses whitespace, control characters and non-strings', () => {
    expect(isPlausibleEmoji('👍 👍')).toBe(false);
    expect(isPlausibleEmoji(' 👍')).toBe(false);
    expect(isPlausibleEmoji('')).toBe(false);
    expect(isPlausibleEmoji(String.fromCharCode(0))).toBe(false);
    expect(isPlausibleEmoji(undefined)).toBe(false);
    expect(isPlausibleEmoji(42)).toBe(false);
  });

  /**
   * ⚠ DELIBERATELY LOOSE, and worth pinning so nobody "fixes" it later. Full
   * emoji validation needs Unicode property tables — the thing this whole file
   * exists to avoid shipping — and the question here is narrower: could a stored
   * value become something surprising? "ok" on your own button is not that.
   */
  it('⚠ lets a short non-emoji through, which is the accepted cost of shipping no tables', () => {
    expect(isPlausibleEmoji('ok')).toBe(true);
  });
});

describe('withRecentEmoji', () => {
  it('puts the newest first', () => {
    expect(withRecentEmoji(['🎉'], '👍')).toEqual(['👍', '🎉']);
  });

  /** ⚠ MOVES rather than duplicates — the bug every recents list has once. */
  it('⚠ moves one already in the list instead of adding a second copy', () => {
    expect(withRecentEmoji(['🎉', '👍', '❤️'], '👍')).toEqual(['👍', '🎉', '❤️']);
  });

  it('caps the list, dropping the oldest', () => {
    const many = Array.from({ length: MAX_RECENT_EMOJI }, (_, index) => `e${index}`);
    const next = withRecentEmoji(many, '👍');

    expect(next).toHaveLength(MAX_RECENT_EMOJI);
    expect(next[0]).toBe('👍');
    expect(next).not.toContain(`e${MAX_RECENT_EMOJI - 1}`);
  });

  it('ignores an implausible value rather than storing it', () => {
    expect(withRecentEmoji(['👍'], 'a whole sentence that is not an emoji at all')).toEqual(['👍']);
  });
});

describe('the catalogue', () => {
  it('has no duplicates across groups', () => {
    expect(new Set(ALL_EMOJI).size).toBe(ALL_EMOJI.length);
  });

  it('gives every group a label and some emoji', () => {
    for (const group of EMOJI_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.emoji.length).toBeGreaterThan(0);
    }
  });

  /**
   * ⚠ THE SIZE IS THE DESIGN. An npm picker ships 200KB–1MB; this is a curated
   * set of plain strings. If it ever grows past a few hundred, the trade that
   * justified writing it by hand has quietly been lost.
   */
  it('⚠ stays small enough to justify not using a library', () => {
    expect(ALL_EMOJI.length).toBeLessThan(400);
    expect(JSON.stringify(EMOJI_GROUPS).length).toBeLessThan(16_000);
  });
});
