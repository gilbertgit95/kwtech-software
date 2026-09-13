import { type DisplayTextRefusal, prepareDisplayText } from './text.js';

/**
 * The name a person chose for public displays.
 *
 * A nickname goes on a TV in a public room, so it is bounded: trimmed, 1–24
 * characters, no control or invisible formatting characters.
 */
export const MAX_NICKNAME_CODE_POINTS = 24;

export function prepareNickname(raw: string): { text: string } | { refused: DisplayTextRefusal } {
  return prepareDisplayText(raw, MAX_NICKNAME_CODE_POINTS);
}

/**
 * The name a public board shows beside a call, or null for none.
 *
 * ⚠ NO NICKNAME MEANS NO NAME — NEVER A FALLBACK TO THE ACCOUNT'S NAME. Only
 * what a person typed for a public screen ever reaches one. A fallback would
 * put a real name on a TV for everyone who never opened the setting, who are
 * exactly the people least aware it exists.
 *
 * It also keeps two other decisions true: a nickname chosen for public display
 * is not personal data in a call event, so the staff subscription stays
 * filtered by workspace alone. ⚠ If a real-name fallback is ever added, that
 * stops being true on the same day.
 *
 * Deliberately takes no account name, so a caller cannot pass one in.
 */
export function boardNickname(showStaffNames: boolean, nickname: string | null | undefined): string | null {
  if (!showStaffNames) return null;
  return nickname ? nickname : null;
}

/** Only the person themselves. Putting words on a public screen in somebody else's name is not an admin power. */
export function canSetNickname(actorId: string, userId: string): boolean {
  return actorId === userId;
}

/** The person themselves, or `queue:manage_windows` — which may clear a nickname, never write one. */
export function canClearNickname(actorId: string, userId: string, holdsManageWindows: boolean): boolean {
  return actorId === userId || holdsManageWindows;
}
