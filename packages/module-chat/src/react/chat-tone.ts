import { playTone, type Tone, type ToneNote, unlockTones } from '@kwtech/web-ui';

/**
 * ── CHAT'S TONES ───────────────────────────────────────────────────────────
 *
 * A short sound when a message arrives, and the whole of what `dnd` can
 * truthfully claim until a notification system exists (§12.44).
 *
 * ## ⚠ The ENGINE moved to `@kwtech/web-ui`; the CATALOGUE stayed
 *
 * How notes become sound — the lazy context, the unlock, the fades, the sweep —
 * is `playTone` in `@kwtech/web-ui` now, because `module-queuing-window`'s public
 * display needs a chime too and may not import chat (PLAN §9 rule 8). Which ten
 * sounds a message can make is still chat's decision, so they are still here,
 * and every name this file exported before still works.
 */

/** @deprecated Kept for chat's public surface — use `ToneNote` from `@kwtech/web-ui`. */
export type ChatToneNote = ToneNote;
/** @deprecated Kept for chat's public surface — use `Tone` from `@kwtech/web-ui`. */
export type ChatTone = Tone;

/**
 * ── THE CATALOGUE ──────────────────────────────────────────────────────────
 *
 * Ten, described rather than recorded, roughly ordered from most discreet to
 * most noticeable so the picker reads as a range rather than a list.
 *
 * ## ⚠ NAMED FOR WHAT THEY SOUND LIKE, NEVER FOR A PRODUCT
 *
 * "Pop", "Ding", "Ping" — not the name of any messenger that has one. A real
 * product's notification sound is a recorded asset somebody owns, so these are
 * ORIGINAL sounds in the same genre; and a tone named after another app sets an
 * expectation this cannot meet.
 *
 * ## Why there is a ceiling at all
 *
 * Every tone has to be auditioned one at a time to be chosen. Ten is about the
 * most that stays a decision rather than a chore.
 */
export const CHAT_TONES: readonly ChatTone[] = [
  {
    id: 'tap',
    label: 'Tap',
    /** One note, as short as is still audible. For somebody who wants almost nothing. */
    notes: [{ hz: 1320, at: 0, ms: 55, shape: 'decay' }],
  },
  {
    id: 'knock',
    label: 'Knock',
    /** Two low, flat notes — the least musical option, for a shared room. */
    notes: [
      { hz: 220, at: 0, ms: 70, shape: 'decay' },
      { hz: 220, at: 110, ms: 70, shape: 'decay' },
    ],
  },
  {
    id: 'pop',
    label: 'Pop',
    /**
     * ⚠ THE BUBBLE-POP EVERY MESSENGER HAS, and it is a SWEEP rather than a
     * note: pitch rising fast through a very short decay is what the ear reads
     * as something bursting.
     */
    notes: [{ hz: 420, toHz: 1180, at: 0, ms: 90, shape: 'decay' }],
  },
  {
    id: 'bubble',
    label: 'Bubble',
    /** Two pops, the second higher and softer. ⚠ THE DEFAULT — see `DEFAULT_CHAT_TONE`. */
    notes: [
      { hz: 360, toHz: 980, at: 0, ms: 85, shape: 'decay' },
      { hz: 620, toHz: 1420, at: 95, ms: 70, shape: 'decay', level: 0.6 },
    ],
  },
  {
    id: 'blip',
    label: 'Blip',
    /** Two quick notes up. Short, and hard to mistake for an OS sound. */
    notes: [
      { hz: 880, at: 0, ms: 90 },
      { hz: 1175, at: 90, ms: 120 },
    ],
  },
  {
    id: 'ping',
    label: 'Ping',
    /** Bright and quick, a fifth apart. `triangle` is what makes it cut through. */
    notes: [
      { hz: 988, at: 0, ms: 70, wave: 'triangle' },
      { hz: 1480, at: 70, ms: 140, wave: 'triangle', shape: 'decay' },
    ],
  },
  {
    id: 'ding',
    label: 'Ding',
    /** One bright note with a long tail, and a quiet octave above so it is not a test tone. */
    notes: [
      { hz: 1046, at: 0, ms: 320, wave: 'triangle', shape: 'decay' },
      { hz: 2093, at: 0, ms: 180, shape: 'decay', level: 0.35 },
    ],
  },
  {
    id: 'chime',
    label: 'Chime',
    /** A rising third, the most musical of them. */
    notes: [
      { hz: 660, at: 0, ms: 110 },
      { hz: 990, at: 80, ms: 200, shape: 'decay' },
    ],
  },
  {
    id: 'marimba',
    label: 'Marimba',
    /** Warm and wooden — two struck notes, a fourth apart, with no sharp edge. */
    notes: [
      { hz: 587, at: 0, ms: 150, wave: 'triangle', shape: 'decay' },
      { hz: 880, at: 90, ms: 220, wave: 'triangle', shape: 'decay' },
    ],
  },
  {
    id: 'alert',
    label: 'Alert',
    /** The loudest option. ⚠ `square` and close notes are what the ear reads as urgent. */
    notes: [
      { hz: 784, at: 0, ms: 80, wave: 'square', level: 0.55 },
      { hz: 1047, at: 95, ms: 80, wave: 'square', level: 0.55 },
      { hz: 784, at: 190, ms: 110, wave: 'square', level: 0.55, shape: 'decay' },
    ],
  },
];

export type ChatToneId = (typeof CHAT_TONES)[number]['id'];

/**
 * Two bubble pops, the second smaller — the sound people already associate with
 * a message arriving.
 *
 * ⚠ CHANGING THIS MOVES NOBODY WHO HAS CHOSEN: the setting lives in
 * `localStorage`, and this is consulted only when nothing valid is stored.
 */
export const DEFAULT_CHAT_TONE: ChatToneId = 'bubble';

export function isChatToneId(value: unknown): value is ChatToneId {
  return typeof value === 'string' && CHAT_TONES.some((tone) => tone.id === value);
}

/**
 * ⚠ THE UNLOCK — call from an event handler, never an effect. The preview button
 * in chat's preferences is what switches the tone on for real. See `unlockTones`.
 */
export function unlockChatTones(): void {
  void unlockTones();
}

/**
 * Plays one of chat's tones, at the engine's default desk-level loudness.
 *
 * ⚠ Never throws — see `playTone`. It does not decide WHETHER to play; that is
 * `shouldPlayTone`, the half that knows about chat. An id this build no longer
 * ships falls back to the first tone rather than silence.
 */
export function playChatTone(id: ChatToneId): void {
  const tone = CHAT_TONES.find((one) => one.id === id) ?? CHAT_TONES[0];
  if (tone) playTone(tone);
}
