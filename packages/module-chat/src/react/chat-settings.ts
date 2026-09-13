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
import { isPlausibleEmoji, MAX_RECENT_EMOJI } from './emoji.js';

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
  /**
   * The one-tap emoji beside the composer. Empty string means no button.
   *
   * ⚠ Per device like everything else here, and that is the RIGHT scope for
   * this one too: the quick button is a habit of the keyboard somebody is
   * sitting at, not a property of who they are.
   */
  quickEmoji: string;
  /**
   * PER-CONVERSATION overrides of the quick button, by conversation id.
   *
   * ⚠ The default is a fallback, not a setting that applies everywhere. A
   * thumbs-up is right for a standup group and wrong for the one conversation
   * where somebody always replies ❤️ or 👀 — so the button is chosen where it
   * is USED, and `quickEmoji` is only what a conversation with no opinion gets.
   *
   * ⚠ Per DEVICE like everything else here, and per PERSON by construction:
   * this is `localStorage`, so it is never shared with the other participants.
   * Two people in one group can have entirely different buttons and neither can
   * see the other's.
   *
   * ⚠ CAPPED. A map keyed by conversation id grows every time somebody
   * customises another thread and nothing ever removes an entry — a conversation
   * can be archived or left and its id lingers. See `MAX_QUICK_OVERRIDES`.
   */
  quickEmojiByConversation: Record<string, string>;
  /**
   * The picker's recents, most recent first.
   *
   * ⚠ Stored rather than held in React state, because the value of a recents
   * list is entirely that it survives — one that resets on reload is a list
   * that is always empty when it matters.
   */
  recentEmoji: string[];
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
export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  enabled: false,
  tone: DEFAULT_CHAT_TONE,
  /**
   * ⚠ A thumbs-up, and the button is ON by default — unlike the tone.
   *
   * The two defaults point opposite ways on purpose. A sound plays without
   * being asked for, in a room that may have other people in it, so silence is
   * the polite default. A button sits there and does nothing until somebody
   * presses it, and it is the single most-sent message in any chat — defaulting
   * it to absent would hide the feature from everybody who never opens
   * preferences.
   */
  quickEmoji: '👍',
  quickEmojiByConversation: {},
  recentEmoji: [],
};

/**
 * How many per-conversation overrides to keep.
 *
 * ⚠ A CAP, because nothing ever deletes one. A conversation can be archived,
 * left, or simply never opened again, and its id stays in this map forever —
 * so without a bound this is a store that only grows, on a device somebody
 * never clears. Fifty is far more than anybody customises by hand, and past it
 * the OLDEST entry is dropped: objects preserve insertion order for string
 * keys, so "oldest" is a real answer rather than an arbitrary one.
 *
 * ⚠ Dropping an override is not destructive — that conversation falls back to
 * the default button, which is what it had before anybody chose.
 */
export const MAX_QUICK_OVERRIDES = 50;

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

    const candidate = parsed as {
      enabled?: unknown;
      tone?: unknown;
      quickEmoji?: unknown;
      quickEmojiByConversation?: unknown;
      recentEmoji?: unknown;
    };
    return {
      enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : DEFAULT_CHAT_SETTINGS.enabled,
      tone: isChatToneId(candidate.tone) ? candidate.tone : DEFAULT_CHAT_SETTINGS.tone,
      /*
       * ⚠ VALIDATED, and this one SENDS. The quick button's value becomes a
       * message body on one tap, and it comes out of storage a person can edit
       * by hand — so an implausible value falls back to none rather than to the
       * default, because silently restoring a button somebody removed is worse
       * than showing no button.
       *
       * `''` is a legitimate stored value: it is "I turned the button off".
       */
      quickEmoji: quickEmojiFrom(candidate.quickEmoji),
      /*
       * ⚠ Every VALUE validated, for the reason `quickEmoji` is: each one can
       * become a message body on one tap. The KEY is a conversation id and is
       * not validated against anything — an id for a conversation the viewer is
       * no longer in simply never matches, which costs a few bytes and is not
       * worth a lookup on every read.
       */
      quickEmojiByConversation: overridesFrom(candidate.quickEmojiByConversation),
      /*
       * ⚠ FILTERED, not taken. Every entry is checked and the list is capped,
       * so a hand-edited array of a thousand strings cannot become a thousand
       * buttons in the picker.
       */
      recentEmoji: Array.isArray(candidate.recentEmoji)
        ? candidate.recentEmoji.filter(isPlausibleEmoji).slice(0, MAX_RECENT_EMOJI)
        : [],
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

/**
 * What a stored `quickEmoji` is worth.
 *
 * ⚠ Three outcomes, not two. Absent means "never chosen", so it takes the
 * default; an empty string means "deliberately removed", so it stays empty; and
 * anything implausible falls back to NO BUTTON rather than to the default,
 * because restoring a button somebody removed is the more surprising failure.
 */
function quickEmojiFrom(stored: unknown): string {
  if (stored === undefined) return DEFAULT_CHAT_SETTINGS.quickEmoji;
  if (stored === '') return '';
  return isPlausibleEmoji(stored) ? stored : '';
}

/**
 * The stored per-conversation overrides, validated and capped.
 *
 * Entries whose value is not a plausible emoji are DROPPED rather than
 * defaulted: an unreadable override means that conversation falls back to the
 * default button, which is what it had before anybody customised it.
 */
function overridesFrom(stored: unknown): Record<string, string> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};

  const entries = Object.entries(stored as Record<string, unknown>)
    /*
     * ⚠ `''` SURVIVES, and `isPlausibleEmoji` refuses it — correctly, since an
     * empty string is not an emoji. Here it is a deliberate "no button in this
     * conversation", which is the answer somebody chose in exactly the thread
     * where a stray tap would be worst. Filtering it out would silently give
     * them the default button back.
     */
    .filter((entry): entry is [string, string] => entry[1] === '' || isPlausibleEmoji(entry[1]))
    .slice(0, MAX_QUICK_OVERRIDES);

  return Object.fromEntries(entries);
}

/**
 * WHICH EMOJI THE QUICK BUTTON SENDS IN THIS CONVERSATION.
 *
 * ⚠ The one place the fallback order is written down, so the composer and the
 * settings screen cannot disagree about it:
 *
 *   1. what this conversation was given, if anything
 *   2. otherwise the person's own default
 *   3. and `''` means NO BUTTON — at either level, deliberately chosen
 *
 * ⚠ An override of `''` is meaningful and is NOT the same as having none: it is
 * "no quick button in this conversation", which somebody may want in exactly
 * the thread where a stray tap would be worst.
 */
export function resolveQuickEmoji(settings: ChatSettings, conversationId: string | null | undefined): string {
  if (!conversationId) return settings.quickEmoji;

  const override = settings.quickEmojiByConversation[conversationId];
  return override === undefined ? settings.quickEmoji : override;
}

/**
 * Set, clear, or remove this conversation's override.
 *
 * @param emoji an emoji to use here, `''` for no button here, or `null` to
 *   FORGET the override entirely so the conversation follows the default again.
 *   ⚠ The last two are different and both are needed: "no button here" and "use
 *   whatever my default is" are answers to different questions.
 */
export function withQuickEmojiFor(settings: ChatSettings, conversationId: string, emoji: string | null): ChatSettings {
  const next = { ...settings.quickEmojiByConversation };

  if (emoji === null) delete next[conversationId];
  else if (emoji === '' || isPlausibleEmoji(emoji)) next[conversationId] = emoji;
  else return settings;

  /*
   * ⚠ Capped on WRITE as well as on read. The read cap protects against a
   * hand-edited store; this one stops the map growing past the bound through
   * ordinary use, dropping the oldest insertion.
   */
  const entries = Object.entries(next);
  const capped = entries.length > MAX_QUICK_OVERRIDES ? entries.slice(entries.length - MAX_QUICK_OVERRIDES) : entries;

  return { ...settings, quickEmojiByConversation: Object.fromEntries(capped) };
}
