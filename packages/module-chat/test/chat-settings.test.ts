import {
  CHAT_SETTINGS_STORAGE_KEY,
  DEFAULT_CHAT_SETTINGS,
  MAX_QUICK_OVERRIDES,
  readChatSettings,
  resolveQuickEmoji,
  withQuickEmojiFor,
  writeChatSettings,
} from '../src/react/chat-settings.js';

/**
 * ── THE PER-DEVICE SETTINGS ────────────────────────────────────────────────
 *
 * ⚠ Every one of these is a way localStorage fails in the wild, and each one
 * lands at the moment a message arrives — which is the moment there is nothing
 * useful to do about it. So all of them resolve to the default instead.
 */

const withStorage = (storage: Partial<Storage>) => {
  (globalThis as { window?: unknown }).window = { localStorage: storage };
};

afterEach(() => {
  (globalThis as { window?: unknown }).window = undefined;
});

describe('readChatSettings', () => {
  it('returns the default with nothing stored', () => {
    withStorage({ getItem: () => null });
    expect(readChatSettings()).toEqual(DEFAULT_CHAT_SETTINGS);
  });

  /**
   * ⚠ SOUND IS OFF UNTIL SOMEBODY ASKS FOR IT. Chat is one page inside a
   * back-office application, and a tab that starts making noise because
   * somebody navigated to the product is a setting people hunt for angrily
   * rather than discover.
   */
  it('⚠ defaults to silence rather than to a sound', () => {
    expect(DEFAULT_CHAT_SETTINGS.enabled).toBe(false);
  });

  it('reads back what was written', () => {
    const store = new Map<string, string>();
    withStorage({
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });

    writeChatSettings({ ...DEFAULT_CHAT_SETTINGS, enabled: true, tone: 'chime' });
    expect(readChatSettings()).toEqual({ ...DEFAULT_CHAT_SETTINGS, enabled: true, tone: 'chime' });
    expect(store.has(CHAT_SETTINGS_STORAGE_KEY)).toBe(true);
  });

  /** ⚠ Safari's private mode, and any browser configured to block site data. */
  it('⚠ survives storage that THROWS rather than returning null', () => {
    withStorage({
      getItem: () => {
        throw new Error('The operation is insecure.');
      },
    });
    expect(readChatSettings()).toEqual(DEFAULT_CHAT_SETTINGS);
  });

  it('survives a value that is not JSON, and one that is the wrong shape', () => {
    withStorage({ getItem: () => 'not json at all' });
    expect(readChatSettings()).toEqual(DEFAULT_CHAT_SETTINGS);

    withStorage({ getItem: () => '"a string"' });
    expect(readChatSettings()).toEqual(DEFAULT_CHAT_SETTINGS);

    withStorage({ getItem: () => 'null' });
    expect(readChatSettings()).toEqual(DEFAULT_CHAT_SETTINGS);
  });

  /**
   * ⚠ THE REASON THE VALUES ARE VALIDATED RATHER THAN CAST. A tone removed in a
   * later build would otherwise come back as an id naming nothing.
   */
  it('⚠ falls back for a tone this build no longer ships, keeping the rest', () => {
    withStorage({ getItem: () => JSON.stringify({ enabled: true, tone: 'fanfare' }) });
    expect(readChatSettings()).toEqual({ ...DEFAULT_CHAT_SETTINGS, enabled: true });
  });

  it('falls back field by field rather than discarding the whole object', () => {
    withStorage({ getItem: () => JSON.stringify({ tone: 'knock' }) });
    expect(readChatSettings()).toEqual({ ...DEFAULT_CHAT_SETTINGS, tone: 'knock' });
  });

  /** Rendered on the server, where there is no window at all. */
  it('returns the default with no window', () => {
    (globalThis as { window?: unknown }).window = undefined;
    expect(readChatSettings()).toEqual(DEFAULT_CHAT_SETTINGS);
  });
});

describe('the quick emoji, which one tap SENDS', () => {
  /**
   * ⚠ THREE OUTCOMES, NOT TWO. Absent means never chosen, so it takes the
   * default. An empty string means deliberately removed, so it stays empty.
   * Anything implausible falls back to NO BUTTON rather than to the default,
   * because silently restoring a button somebody removed is the more surprising
   * failure.
   */
  it('⚠ takes the default when absent, and stays empty when cleared', () => {
    withStorage({ getItem: () => JSON.stringify({ enabled: true }) });
    expect(readChatSettings().quickEmoji).toBe(DEFAULT_CHAT_SETTINGS.quickEmoji);

    withStorage({ getItem: () => JSON.stringify({ quickEmoji: '' }) });
    expect(readChatSettings().quickEmoji).toBe('');
  });

  /**
   * ⚠ THE ONE THAT MATTERS. This value becomes a message body on one tap, and
   * it comes out of storage a person can edit by hand.
   */
  it('⚠ refuses a stored value long enough to be a message', () => {
    withStorage({ getItem: () => JSON.stringify({ quickEmoji: 'please approve the budget by friday' }) });
    expect(readChatSettings().quickEmoji).toBe('');
  });

  it('keeps a real emoji, including a sequence', () => {
    withStorage({ getItem: () => JSON.stringify({ quickEmoji: '👨‍👩‍👧‍👦' }) });
    expect(readChatSettings().quickEmoji).toBe('👨‍👩‍👧‍👦');
  });

  /** ⚠ Filtered and capped: a hand-edited array must not become a thousand buttons. */
  it('⚠ filters and caps the recents rather than trusting them', () => {
    withStorage({
      getItem: () => JSON.stringify({ recentEmoji: ['👍', 'a whole sentence here', '🎉', ...Array(50).fill('❤️')] }),
    });

    const recent = readChatSettings().recentEmoji;
    expect(recent).not.toContain('a whole sentence here');
    expect(recent.length).toBeLessThanOrEqual(16);
  });

  it('reads a non-array recents list as empty', () => {
    withStorage({ getItem: () => JSON.stringify({ recentEmoji: 'not an array' }) });
    expect(readChatSettings().recentEmoji).toEqual([]);
  });
});

describe('writeChatSettings', () => {
  /**
   * ⚠ SILENT ON FAILURE. Storage can be full or blocked, and there is nowhere
   * sensible to surface it from — the control still shows what was asked for,
   * because the component holds it in React state, so the setting works for
   * this session either way.
   */
  it('⚠ does not throw when storage refuses the write', () => {
    withStorage({
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => writeChatSettings({ ...DEFAULT_CHAT_SETTINGS, enabled: true, tone: 'tap' })).not.toThrow();
  });
});

/**
 * ── THE QUICK BUTTON, PER CONVERSATION ─────────────────────────────────────
 *
 * A thumbs-up is right for a standup group and wrong for the one conversation
 * where somebody always replies ❤️ or 👀. So the button is chosen where it is
 * USED, and the person's own default is only what a conversation with no
 * opinion gets.
 *
 * ⚠ Per DEVICE and per PERSON by construction — this is localStorage, so it is
 * never sent anywhere. Two people in one group can have different buttons and
 * neither can see the other's.
 */
describe('resolveQuickEmoji', () => {
  const settings = { ...DEFAULT_CHAT_SETTINGS, quickEmoji: '👍', quickEmojiByConversation: { c1: '❤️', c2: '' } };

  it('uses the conversation’s own choice when it has one', () => {
    expect(resolveQuickEmoji(settings, 'c1')).toBe('❤️');
  });

  it('falls back to the default for a conversation that has none', () => {
    expect(resolveQuickEmoji(settings, 'c9')).toBe('👍');
  });

  /**
   * ⚠ AN OVERRIDE OF `''` IS NOT THE SAME AS HAVING NONE. It is "no quick
   * button in this conversation", which somebody may want in exactly the thread
   * where a stray tap would be worst — and it must not silently fall through to
   * the default.
   */
  it('⚠ honours an explicit "no button here" rather than falling back', () => {
    expect(resolveQuickEmoji(settings, 'c2')).toBe('');
  });

  it('uses the default with no conversation at all', () => {
    expect(resolveQuickEmoji(settings, null)).toBe('👍');
    expect(resolveQuickEmoji(settings, undefined)).toBe('👍');
  });

  /** ⚠ The default itself can be empty: then nothing has a button anywhere. */
  it('⚠ shows no button when the default is cleared and nothing overrides it', () => {
    expect(resolveQuickEmoji({ ...settings, quickEmoji: '' }, 'c9')).toBe('');
  });
});

describe('withQuickEmojiFor', () => {
  const base = { ...DEFAULT_CHAT_SETTINGS, quickEmoji: '👍' };

  it('sets one conversation without touching another', () => {
    const next = withQuickEmojiFor(withQuickEmojiFor(base, 'c1', '❤️'), 'c2', '🎉');

    expect(resolveQuickEmoji(next, 'c1')).toBe('❤️');
    expect(resolveQuickEmoji(next, 'c2')).toBe('🎉');
    expect(resolveQuickEmoji(next, 'c3')).toBe('👍');
  });

  /**
   * ⚠ THREE STATES, AND THE LAST TWO ARE DIFFERENT ANSWERS. `null` forgets the
   * override so the conversation follows whatever the default becomes later;
   * `''` is a choice to have no button in this thread specifically.
   */
  it('⚠ tells "use my default" apart from "no button here"', () => {
    const withNone = withQuickEmojiFor(base, 'c1', '');
    expect(resolveQuickEmoji(withNone, 'c1')).toBe('');

    const forgotten = withQuickEmojiFor(withNone, 'c1', null);
    expect(forgotten.quickEmojiByConversation.c1).toBeUndefined();
    expect(resolveQuickEmoji(forgotten, 'c1')).toBe('👍');
  });

  it('refuses an implausible value rather than storing something sendable', () => {
    const next = withQuickEmojiFor(base, 'c1', 'approve the budget please');
    expect(next.quickEmojiByConversation.c1).toBeUndefined();
  });

  /**
   * ⚠ NOTHING EVER DELETES AN OVERRIDE on its own — a conversation can be
   * archived, left, or never opened again, and its id stays in this map. Without
   * a bound it is a store that only grows on a device nobody clears.
   */
  it('⚠ caps the map, dropping the oldest rather than growing forever', () => {
    let settings = base;
    for (let index = 0; index < MAX_QUICK_OVERRIDES + 5; index += 1) {
      settings = withQuickEmojiFor(settings, `c${index}`, '🎉');
    }

    const keys = Object.keys(settings.quickEmojiByConversation);
    expect(keys).toHaveLength(MAX_QUICK_OVERRIDES);
    // The oldest went; the newest stayed.
    expect(keys).not.toContain('c0');
    expect(keys).toContain(`c${MAX_QUICK_OVERRIDES + 4}`);
  });
});

describe('reading the overrides back', () => {
  it('keeps a valid map and drops entries that are not sendable', () => {
    withStorage({
      getItem: () => JSON.stringify({ quickEmojiByConversation: { c1: '❤️', c2: 'a whole sentence', c3: '' } }),
    });

    const stored = readChatSettings().quickEmojiByConversation;
    expect(stored.c1).toBe('❤️');
    expect(stored.c2).toBeUndefined();
    // ⚠ '' survives: it is a deliberate "no button here", not a broken value.
    expect(stored.c3).toBe('');
  });

  it('reads a non-object as no overrides', () => {
    withStorage({ getItem: () => JSON.stringify({ quickEmojiByConversation: ['nope'] }) });
    expect(readChatSettings().quickEmojiByConversation).toEqual({});
  });
});
