/**
 * ORDER SOUNDS (issue #68): the tone the Cashier screen plays when a held
 * order arrives, and the one it plays when a waiting order is updated.
 *
 * Pure, and the one copy of the rule: the server checks what it is asked to
 * store with `validateAlertTones`, reads what it stored back with
 * `readAlertTones`, and the browser picks what plays with
 * `effectiveAlertTones` — so a saved choice the till cannot play never
 * reaches it.
 *
 * - **Built-in tones only** (the operator, 2026-11-05): a few short sounds the
 *   browser makes itself (Web Audio), so there is no file to store, upload or
 *   lose. Their notes live in `react/view/tone-notes.ts`; only the ids are here.
 * - **Set per store, and per person.** The store's are the defaults
 *   (`pos:manage_settings`); a person may keep their own (`pos:take_payment`),
 *   which wins whole — never merged field by field, so "my sounds" is exactly
 *   what that person chose.
 */

/** The built-in tones, by id. ⚠ NEVER RENAME ONE: ids are stored. A removed id reads as the default. */
export const POS_ALERT_TONE_IDS = ['chime', 'bell', 'ding', 'marimba', 'pop'] as const;
export type PosAlertToneId = (typeof POS_ALERT_TONE_IDS)[number];

/** The two moments a sound is for. */
export type PosAlertMoment = 'newOrder' | 'updatedOrder';

/** One moment's sound: whether it plays, which tone, and how loud (0–100). */
export interface PosAlertSound {
  on: boolean;
  tone: PosAlertToneId;
  volume: number;
}

export interface PosAlertTones {
  newOrder: PosAlertSound;
  updatedOrder: PosAlertSound;
}

/**
 * What a store plays before anybody chose: on, so a new store's cashier
 * hears an order arrive; a softer, shorter tone for an update, so the two
 * are told apart by ear.
 */
export const DEFAULT_POS_ALERT_TONES: PosAlertTones = {
  newOrder: { on: true, tone: 'chime', volume: 70 },
  updatedOrder: { on: true, tone: 'pop', volume: 50 },
};

const MOMENTS: readonly PosAlertMoment[] = ['newOrder', 'updatedOrder'];

const MOMENT_NAMES: Record<PosAlertMoment, string> = {
  newOrder: 'A new order',
  updatedOrder: 'An updated order',
};

export function isPosAlertToneId(value: unknown): value is PosAlertToneId {
  return typeof value === 'string' && (POS_ALERT_TONE_IDS as readonly string[]).includes(value);
}

/**
 * Checks a choice before it is stored. Every moment must be there, whole: a
 * save always sends both, and a half-sent one is a bug to refuse, not to fill
 * in. The reasons name the moment, in plain words.
 */
export function validateAlertTones(input: unknown): { tones: PosAlertTones } | { refused: string[] } {
  if (typeof input !== 'object' || input === null) return { refused: ['The order sounds are missing.'] };
  const problems: string[] = [];
  const tones = { ...DEFAULT_POS_ALERT_TONES };
  for (const moment of MOMENTS) {
    const sound = (input as Record<string, unknown>)[moment];
    const name = MOMENT_NAMES[moment];
    if (typeof sound !== 'object' || sound === null) {
      problems.push(`${name}: its sound is missing.`);
      continue;
    }
    const { on, tone, volume } = sound as Record<string, unknown>;
    if (typeof on !== 'boolean') problems.push(`${name}: say whether it plays.`);
    if (!isPosAlertToneId(tone)) problems.push(`${name}: “${String(tone)}” is not one of the tones.`);
    if (typeof volume !== 'number' || !Number.isInteger(volume) || volume < 0 || volume > 100) {
      problems.push(`${name}: the volume is a whole number from 0 to 100.`);
    }
    if (typeof on === 'boolean' && isPosAlertToneId(tone) && typeof volume === 'number') {
      tones[moment] = { on, tone, volume };
    }
  }
  return problems.length > 0 ? { refused: problems } : { tones };
}

/**
 * A stored choice, never trusted as typed: JSON from the database is read
 * leniently, field by field, and anything unreadable — a tone removed since,
 * a volume out of range — falls back to the default for that field. Null
 * (nothing stored) is every default.
 */
export function readAlertTones(stored: unknown): PosAlertTones {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_POS_ALERT_TONES;
  const read = (moment: PosAlertMoment): PosAlertSound => {
    const fallback = DEFAULT_POS_ALERT_TONES[moment];
    const sound = (stored as Record<string, unknown>)[moment];
    if (typeof sound !== 'object' || sound === null) return fallback;
    const { on, tone, volume } = sound as Record<string, unknown>;
    return {
      on: typeof on === 'boolean' ? on : fallback.on,
      tone: isPosAlertToneId(tone) ? tone : fallback.tone,
      volume:
        typeof volume === 'number' && Number.isFinite(volume)
          ? Math.min(100, Math.max(0, Math.round(volume)))
          : fallback.volume,
    };
  };
  return { newOrder: read('newOrder'), updatedOrder: read('updatedOrder') };
}

/** What plays for this person: their own choice when they kept one, otherwise the store's. */
export function effectiveAlertTones(store: PosAlertTones, mine: PosAlertTones | null): PosAlertTones {
  return mine ?? store;
}
