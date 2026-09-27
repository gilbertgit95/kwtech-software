import type { NoteRefusal } from '../types.js';

/**
 * Tags: labels on ONE note, never rows in a shared vocabulary (NOTE-PLAN
 * decision 9). The filter lists the distinct tags on the notes the viewer can
 * see, so a tag on a private note never reaches anybody else.
 */

/** How many tags one note may carry. */
export const NOTE_TAGS_MAX = 10;

/** In code points, after normalising. */
export const NOTE_TAG_MAX = 32;

const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * One tag as it is stored and compared: NFC, a leading `#` dropped, lower case,
 * whitespace runs as one hyphen. `#Opening Checklist` and `opening-checklist`
 * are then one tag, rather than two a filter shows side by side.
 *
 * Null for a tag that normalises to nothing.
 */
export function normalizeNoteTag(raw: string): string | null {
  const tag = raw.normalize('NFC').trim().replace(/^#+/u, '').trim().toLowerCase().replace(/\s+/gu, '-');
  return tag.length === 0 ? null : tag;
}

/**
 * A note's tags as they will be stored, or why they are refused.
 *
 * Empty entries are DROPPED (a trailing comma in the field is not a mistake worth
 * refusing); duplicates after normalising are dropped; the order typed is kept.
 * Anything else wrong refuses the whole list, so a save never stores a list
 * different from the one on screen without saying so.
 */
export function prepareNoteTags(raw: readonly string[]): { tags: readonly string[] } | { refused: NoteRefusal } {
  const tags = normalizeNoteTags(raw);
  if (tags.some((tag) => CONTROL_OR_INVISIBLE.test(tag) || [...tag].length > NOTE_TAG_MAX)) {
    return { refused: 'invalid_tags' };
  }
  if (tags.length > NOTE_TAGS_MAX) return { refused: 'invalid_tags' };
  return { tags };
}

/**
 * A list of tags as it is stored and compared: each normalised, empties and
 * duplicates dropped, order kept. The editor compares by this, as it does
 * titles by `normalizeNoteTitle`.
 */
export function normalizeNoteTags(raw: readonly string[]): string[] {
  const tags: string[] = [];
  for (const entry of raw) {
    const tag = normalizeNoteTag(entry);
    if (tag !== null && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}
