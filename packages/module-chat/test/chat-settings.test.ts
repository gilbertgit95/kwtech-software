import {
  CHAT_SETTINGS_STORAGE_KEY,
  DEFAULT_CHAT_SETTINGS,
  readChatSettings,
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

    writeChatSettings({ enabled: true, tone: 'chime' });
    expect(readChatSettings()).toEqual({ enabled: true, tone: 'chime' });
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
    expect(readChatSettings()).toEqual({ enabled: true, tone: DEFAULT_CHAT_SETTINGS.tone });
  });

  it('falls back field by field rather than discarding the whole object', () => {
    withStorage({ getItem: () => JSON.stringify({ tone: 'knock' }) });
    expect(readChatSettings()).toEqual({ enabled: DEFAULT_CHAT_SETTINGS.enabled, tone: 'knock' });
  });

  /** Rendered on the server, where there is no window at all. */
  it('returns the default with no window', () => {
    (globalThis as { window?: unknown }).window = undefined;
    expect(readChatSettings()).toEqual(DEFAULT_CHAT_SETTINGS);
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
    expect(() => writeChatSettings({ enabled: true, tone: 'tap' })).not.toThrow();
  });
});
