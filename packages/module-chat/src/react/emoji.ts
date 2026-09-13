/**
 * ── THE EMOJI PICKER'S DATA ────────────────────────────────────────────────
 *
 * ## ⚠ CURATED, NOT A LIBRARY
 *
 * Every npm emoji picker ships the full Unicode set with names, keywords and
 * usually sprite sheets — **200KB to well over 1MB**, hanging off a text box in
 * a back-office application. The plan deferred a picker for exactly that
 * reason, and this is the answer it named: a curated set plus a recents row.
 *
 * What that gives up, plainly: the complete catalogue, search by name, skin-tone
 * variants beyond the few listed, and flags. What it costs is a couple of
 * kilobytes of plain strings. ⚠ And it gives up nothing for somebody who wants
 * an emoji that is not here, because **the OS picker still works** — these are
 * Unicode text in a normal textarea, which is why no schema and no server change
 * was ever needed. This is a shortcut to the common ones, not the only way in.
 *
 * ## ⚠ Ordered by USE, not by codepoint
 *
 * The first row of each group is what people actually send. A picker ordered by
 * the Unicode tables puts ☺ before 😂 and makes somebody hunt.
 */

export interface EmojiGroup {
  /** The tab's label. Short — these sit in a row at the top of a small popover. */
  label: string;
  emoji: readonly string[];
}

export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    label: 'Smileys',
    emoji: [
      '😀',
      '😃',
      '😄',
      '😁',
      '😆',
      '😅',
      '🤣',
      '😂',
      '🙂',
      '🙃',
      '😉',
      '😊',
      '😇',
      '🥰',
      '😍',
      '🤩',
      '😘',
      '😗',
      '😚',
      '😙',
      '😋',
      '😛',
      '😜',
      '🤪',
      '😝',
      '🤗',
      '🤭',
      '🤔',
      '🤐',
      '😐',
      '😑',
      '😶',
      '😏',
      '😒',
      '🙄',
      '😬',
      '😮',
      '😯',
      '😴',
      '🤤',
      '😪',
      '😵',
      '🤯',
      '🥳',
      '😎',
      '🤓',
      '🧐',
      '😕',
      '😟',
      '🙁',
      '😢',
      '😭',
      '😤',
      '😠',
      '😡',
      '🥺',
      '😳',
      '🤥',
      '😱',
      '🤒',
    ],
  },
  {
    label: 'Gestures',
    emoji: [
      '👍',
      '👎',
      '👌',
      '🤌',
      '✌️',
      '🤞',
      '🤟',
      '🤘',
      '🤙',
      '👈',
      '👉',
      '👆',
      '👇',
      '☝️',
      '✋',
      '🤚',
      '🖐️',
      '🖖',
      '👋',
      '🤝',
      '🙏',
      '✍️',
      '💪',
      '🦾',
      '👏',
      '🙌',
      '👐',
      '🤲',
      '🫶',
      '🤦',
      '🤷',
      '💁',
      '🙋',
      '🙆',
      '🙅',
      '🧏',
      '💅',
      '🤳',
      '👀',
      '🫡',
    ],
  },
  {
    label: 'Hearts',
    emoji: [
      '❤️',
      '🧡',
      '💛',
      '💚',
      '💙',
      '💜',
      '🖤',
      '🤍',
      '🤎',
      '💔',
      '❣️',
      '💕',
      '💞',
      '💓',
      '💗',
      '💖',
      '💘',
      '💝',
      '💟',
      '♥️',
    ],
  },
  {
    label: 'Things',
    emoji: [
      '🔥',
      '✨',
      '🎉',
      '🎊',
      '🎈',
      '🎁',
      '🏆',
      '🥇',
      '⭐',
      '🌟',
      '💡',
      '📌',
      '📎',
      '📅',
      '📈',
      '📉',
      '📝',
      '📖',
      '💼',
      '🔒',
      '🔑',
      '⏰',
      '⌛',
      '☕',
      '🍕',
      '🍔',
      '🍻',
      '🥂',
      '🍰',
      '🎂',
      '✅',
      '❌',
      '⚠️',
      '❓',
      '❗',
      '💯',
      '🚀',
      '🐛',
      '🔧',
      '🧪',
    ],
  },
];

/** Flat, for validation and for "is this one of ours". */
export const ALL_EMOJI: readonly string[] = EMOJI_GROUPS.flatMap((group) => [...group.emoji]);

/**
 * ⚠ The cap on anything stored as "an emoji".
 *
 * A ZWJ sequence like 👨‍👩‍👧‍👦 is SEVEN code points and a flag is two, so this
 * cannot be 1 or 2. It exists because both the quick emoji and the recents list
 * come back out of `localStorage`, which a person can edit by hand — and the
 * quick button SENDS its value. Without a cap, a hand-edited entry is an
 * arbitrary message body one tap away.
 */
const MAX_EMOJI_CODE_POINTS = 12;

/**
 * Whitespace and control characters — refused inside a stored "emoji".
 *
 * ⚠ Matching control characters IS the point, which is what the rule below
 * normally catches: a stored value carrying one would render as a blank button
 * somebody cannot see, and could be sent as a message body containing it.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters in a hand-editable stored value is the purpose of this pattern, not an accident.
const NOT_IN_AN_EMOJI = /[\s\u0000-\u001f\u007f]/;

/**
 * Is this a plausible single emoji?
 *
 * ⚠ DELIBERATELY NOT a full Unicode emoji validation. That needs property
 * tables — the thing this file exists to avoid shipping — and the question that
 * matters is narrower: could this string, if somebody hand-edited their own
 * storage, become a message body or a button label it should not be? So it
 * bounds the length and refuses whitespace and control characters, and lets any
 * short graphic string through.
 *
 * ⚠ The cost of being loose is that somebody can set their own quick button to
 * "ok". That is THEIR device and THEIR button, so this is not a security
 * property — it is a guard against a stored value rendering as something
 * surprising, or an invisible control character becoming a blank button.
 */
export function isPlausibleEmoji(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();
  if (trimmed === '' || trimmed !== value) return false;
  if ([...trimmed].length > MAX_EMOJI_CODE_POINTS) return false;

  return !NOT_IN_AN_EMOJI.test(trimmed);
}

/** How many recents to keep. One row in the picker, and no scrollbar. */
export const MAX_RECENT_EMOJI = 16;

/**
 * The recents list with `chosen` moved to the front.
 *
 * ⚠ PURE, so the ordering rule is testable without a browser — it is the one
 * part of a recents list that is ever subtly wrong. Re-picking an emoji already
 * in the list MOVES it rather than adding a second copy, and the list is capped
 * from the front so the oldest falls off the end.
 */
export function withRecentEmoji(recent: readonly string[], chosen: string): string[] {
  if (!isPlausibleEmoji(chosen)) return [...recent];
  return [chosen, ...recent.filter((one) => one !== chosen)].slice(0, MAX_RECENT_EMOJI);
}

/**
 * Insert `emoji` into `text` at the caret, and say where the caret goes next.
 *
 * ⚠ A PURE FUNCTION over the string, because this is the part that is easy to
 * get wrong: inserting at the caret must REPLACE a selection if there is one,
 * and must leave the caret AFTER the inserted emoji rather than back at the
 * start. Appending to the end instead — which is what a naive picker does —
 * moves somebody's cursor without asking every time they pick one mid-sentence.
 *
 * ⚠ The caret is measured in UTF-16 UNITS, not code points, because that is what
 * `selectionStart` and `setSelectionRange` speak. Mixing the two here is how an
 * emoji lands inside a previous emoji and produces a broken glyph.
 */
export function insertEmoji(
  text: string,
  emoji: string,
  selection: { start: number; end: number },
): { text: string; caret: number } {
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));

  return {
    text: `${text.slice(0, start)}${emoji}${text.slice(end)}`,
    caret: start + emoji.length,
  };
}

/**
 * What the quick button may be set to, from either settings screen.
 *
 * ⚠ A SHORT LIST, not the whole picker. This is the one-tap reply — the handful
 * of things people actually send alone — and offering four hundred here would
 * make choosing one a task. Anything else is still reachable: the composer's
 * picker inserts any emoji into a message.
 *
 * ⚠ Shared by `/chat/preferences` (the default) and by a conversation's own
 * settings (the override) rather than declared in each, so the two screens
 * cannot come to offer different choices for one setting.
 */
export const QUICK_EMOJI_CHOICES: readonly string[] = ['👍', '👌', '🙏', '❤️', '🎉', '😂', '👀', '✅', '🔥', '💯'];
