import { FILE_VISIBILITIES, type FileAudience, type FileRefusal, type FileVisibility } from '../types.js';

/**
 * What a file is allowed to be, and who may see it. Pure: the server enforces
 * every rule here, and the page uses the same functions to explain itself.
 */

/** The longest file name kept, in characters. Longer is refused, not cut: a cut name could hide its extension. */
export const FILE_NAME_MAX = 255;

/** The most people one file can be shared with by name. Past this, share it with the workspace. */
export const FILE_SHARE_PEOPLE_MAX = 50;

/** The longest declared content type kept. Anything longer is replaced, not refused: it is only an icon. */
export const FILE_CONTENT_TYPE_MAX = 127;

/** The type kept when the browser declared none, or one not worth keeping. */
export const FILE_DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/** One MiB, in bytes. Limits are declared in MB (`FILE_LIMIT`); every comparison is in bytes. */
export const FILE_BYTES_PER_MB = 1024 * 1024;

/**
 * ⚠ THE CEILING OF ANY PER-FILE CAP, in MB: a size crosses GraphQL as `Int`,
 * which is 32-bit, so a file of 2 GiB or more cannot be described. A plan
 * may set a higher cap; it is held at this.
 */
export const FILE_SIZE_CEILING_MB = 2047;

/**
 * Control characters (C0, DEL, C1) and the invisible formatting characters a
 * name can use to look like another one ("invoice" + U+202E + "fdp.exe"
 * reads as "invoiceexe.pdf"). Refused, because a file name is something people trust.
 */
/** Each range is `[first, last]` code points, inclusive. */
const UNSAFE_NAME_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

/** Code points, not a regular expression: a pattern of control characters is one nobody can read or lint. */
function hasUnsafeCharacter(name: string): boolean {
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (UNSAFE_NAME_RANGES.some(([first, last]) => code >= first && code <= last)) return true;
  }
  return false;
}

/** A name as it will be kept: trimmed, or `{ refused }`. Slashes are allowed — the name is never a path. */
export function prepareFileName(raw: string): string | { refused: FileRefusal } {
  const name = raw.trim();
  if (name.length === 0 || name.length > FILE_NAME_MAX) return { refused: 'invalid_name' };
  if (hasUnsafeCharacter(name)) return { refused: 'invalid_name' };
  // `.` and `..` alone are names of nothing, and are what a careless store would join as a path.
  if (name === '.' || name === '..') return { refused: 'invalid_name' };
  return name;
}

/**
 * The declared type, kept only when it looks like one (`type/subtype`), so a
 * long or strange string does not reach the database or the page.
 */
export function prepareContentType(raw: string | null | undefined): string {
  const value = (raw ?? '').trim().toLowerCase();
  if (value.length === 0 || value.length > FILE_CONTENT_TYPE_MAX) return FILE_DEFAULT_CONTENT_TYPE;
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(value) ? value : FILE_DEFAULT_CONTENT_TYPE;
}

export function isFileVisibility(value: string): value is FileVisibility {
  return (FILE_VISIBILITIES as readonly string[]).includes(value);
}

/**
 * Whether `viewerId` may see the file: list it, download it.
 *
 * ⚠ THE ONE RULE every read, every download and every live event applies. No
 * key opens somebody else's private file — not `file:manage`, not a super
 * admin's: "private" is a promise made to the owner.
 */
export function canSeeFile(file: FileAudience, viewerId: string): boolean {
  if (file.ownerId === viewerId) return true;
  switch (file.visibility) {
    case 'private':
      return false;
    case 'workspace':
      return true;
    case 'people':
      return file.sharedWith.includes(viewerId);
  }
}

/** Only the owner shares, re-shares or deletes a file. */
export function canChangeFile(file: Pick<FileAudience, 'ownerId'>, actorId: string): boolean {
  return file.ownerId === actorId;
}

export interface FileSharingDraft {
  visibility: string;
  sharedWith: readonly string[];
}

export interface FileSharing {
  visibility: FileVisibility;
  /** Empty unless `people`. The owner is never in it: they always see their own file. */
  sharedWith: string[];
}

/**
 * Who a file will be shared with, checked: or `{ refused }`.
 *
 * `shareable` is who MAY be chosen (active members holding `file:read`), or
 * null when nobody can be named — the member directory is not bound — in which
 * case `people` is refused rather than allowed blind.
 */
export function prepareFileSharing(
  draft: FileSharingDraft,
  ownerId: string,
  shareable: ReadonlySet<string> | null,
): FileSharing | { refused: FileRefusal } {
  if (!isFileVisibility(draft.visibility)) return { refused: 'invalid_visibility' };
  if (draft.visibility !== 'people') return { visibility: draft.visibility, sharedWith: [] };

  const people = [...new Set(draft.sharedWith.filter((userId) => userId !== ownerId))];
  if (people.length === 0) return { refused: 'invalid_people' };
  if (people.length > FILE_SHARE_PEOPLE_MAX) return { refused: 'too_many_people' };
  if (!shareable) return { refused: 'not_shareable' };
  if (people.some((userId) => !shareable.has(userId))) return { refused: 'not_shareable' };
  return { visibility: 'people', sharedWith: people.sort() };
}

/** The people who can see the file now and could not before: the ones to tell. Never the owner. */
export function newlySharedWith(before: FileAudience | null, after: FileAudience): string[] {
  if (after.visibility !== 'people') return [];
  return after.sharedWith.filter((userId) => userId !== after.ownerId && !(before && canSeeFile(before, userId)));
}

/** "12 KB", "3.4 MB": for the page, and for refusals that name a size. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = value >= 10 ? Math.round(value).toString() : (Math.round(value * 10) / 10).toString();
  return `${shown} ${units[unit]}`;
}
