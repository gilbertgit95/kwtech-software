/**
 * ── HOW CHAT TELLS YOU, stored per DEVICE ──────────────────────────────────
 *
 * Two decisions: whether a message makes a sound, and which sound. Both live in
 * `localStorage`, and that is a deliberate answer rather than the lazy one.
 *
 * ## ⚠ Why not the database
 *
 * Because the honest scope of the setting is this machine. Somebody muting chat
 * at a shared desk means "not out loud, here" — not on their phone, and not on
 * the laptop they open at home tonight. A synced preference would silence the
 * device they actually need to hear. The theme preference is stored exactly
 * here for exactly this reason, and that precedent is the one being followed.
 *
 * It also costs nothing: no column, no migration, no mutation, no resolver, and
 * no read on the path where a message arrives.
 *
 * ## ⚠ TWO VALUES, NOT ONE
 *
 * `enabled: false` is kept apart from the tone rather than collapsed into a
 * tone called "off". They are the same control on screen and a different thing
 * in the store: muting and unmuting must give you back the sound you chose, not
 * reset you to the default one. A single field cannot remember that.
 */

import { CHAT_TONES, type ChatToneId, DEFAULT_CHAT_TONE, isChatToneId } from './chat-tone.js';

/**
 * ⚠ `kwtech_` prefixed, like every other preference these apps store.
 * localStorage is scoped per ORIGIN, and `pnpm dev` runs several of these apps
 * on one machine by design, so an unprefixed `chat_settings` is one app
 * silently reading another's. It is also what makes them greppable.
 *
 * ⚠ ONE KEY holding both values rather than a key each. They are one decision
 * to the person making it, they are read together on every arrival, and a
 * third chat preference should not mean a third key nobody cross-checks
 * against the other two.
 */
export const CHAT_SETTINGS_STORAGE_KEY = 'kwtech_chat_settings';

export interface ChatSettings {
  /** Whether an arriving message makes any sound at all. */
  enabled: boolean;
  /** Which sound, remembered across a mute. */
  tone: ChatToneId;
}

/**
 * ⚠ SOUND IS OFF UNTIL SOMEBODY ASKS FOR IT.
 *
 * The other direction is defensible for a chat people chose to open, and it is
 * wrong here: chat is one page inside a back-office application, and a browser
 * tab that starts making noise because somebody navigated to the product is a
 * setting people hunt for angrily rather than discover. Opt-in also means the
 * first tone anybody hears is the one they just previewed in settings, which is
 * the same gesture that unlocks playback.
 */
export const DEFAULT_CHAT_SETTINGS: ChatSettings = { enabled: false, tone: DEFAULT_CHAT_TONE };

/**
 * What is stored, or the default.
 *
 * ⚠ EVERY FAILURE RETURNS THE DEFAULT, and there are more of them than there
 * look to be: no `window` at all (this is read during a server render), storage
 * that THROWS on access rather than returning null (Safari's private mode, and
 * a browser configured to block site data), absent, unparseable, parseable but
 * the wrong shape, and a tone id this build no longer ships.
 *
 * ⚠ The last one is the reason the values are validated rather than cast. A
 * tone removed in a later build would otherwise come back as a `ChatToneId`
 * that names nothing, and the failure lands at the moment a message arrives —
 * the one moment there is nothing useful to do about it.
 */
export function readChatSettings(): ChatSettings {
  if (typeof window === 'undefined') return DEFAULT_CHAT_SETTINGS;

  try {
    const raw = window.localStorage.getItem(CHAT_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_CHAT_SETTINGS;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CHAT_SETTINGS;

    const candidate = parsed as { enabled?: unknown; tone?: unknown };
    return {
      enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : DEFAULT_CHAT_SETTINGS.enabled,
      tone: isChatToneId(candidate.tone) ? candidate.tone : DEFAULT_CHAT_SETTINGS.tone,
    };
  } catch {
    return DEFAULT_CHAT_SETTINGS;
  }
}

/**
 * Stores both values.
 *
 * ⚠ SILENT ON FAILURE, which is the right shape for this one: storage can be
 * full or blocked, and a preference that could not be written is a preference
 * that reverts on reload. Telling somebody their sound choice did not save
 * would be worth an error; there is nowhere sensible to put it from here, so
 * the caller gets the value it asked for and the store is best-effort. ⚠ The
 * CONTROL still reflects what was asked for, because the component holds it in
 * React state — the setting works for this session either way.
 */
export function writeChatSettings(settings: ChatSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHAT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // See above: a preference is not worth a thrown error.
  }
}

/** The tones, as a picker's options. One list, from the catalogue itself. */
export const CHAT_TONE_CHOICES = CHAT_TONES.map((tone) => ({ value: tone.id, label: tone.label }));
