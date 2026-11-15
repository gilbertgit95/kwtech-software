import { nextDayKey, zonedDayKey } from '@kwtech/module-kit';
import { formatFileSize, prepareFileName } from '../../domain/files.js';
import { fileDeletionAt } from '../../domain/retention.js';

/**
 * The page's words and checks, as pure functions so they are tested without a
 * browser (`test/files-view.test.ts`). Every rule here is the SERVER's too;
 * the page uses them only to explain itself sooner.
 */

/** "Private", "Shared with the workspace", "Shared with Ana and 2 others" — from the viewer's side. */
export function sharingLabel(file: {
  mine: boolean;
  visibility: string;
  sharedWith: readonly { displayName: string }[];
}): string {
  switch (file.visibility) {
    case 'private':
      return 'Private';
    case 'workspace':
      return 'Shared with the workspace';
    case 'people': {
      if (!file.mine) return 'Shared with you';
      const [first, ...rest] = file.sharedWith;
      if (!first) return 'Shared with chosen people';
      if (rest.length === 0) return `Shared with ${first.displayName}`;
      return `Shared with ${first.displayName} and ${rest.length} ${rest.length === 1 ? 'other' : 'others'}`;
    }
    default:
      return 'Private';
  }
}

/** "Deleted at 10 PM on Tue, 17 Nov" — the first nightly clean-up after the file is old enough. */
export function deletionLabel(
  createdAt: string,
  retentionHours: number,
  timeZone: string,
  cleanupTime: string,
): string {
  const at = fileDeletionAt(new Date(createdAt), retentionHours, timeZone, cleanupTime);
  if (!at) return 'Deleted by the nightly clean-up';
  const time = at.toLocaleTimeString(undefined, { timeZone, hour: 'numeric', minute: '2-digit' });
  const day = at.toLocaleDateString(undefined, { timeZone, weekday: 'short', day: 'numeric', month: 'short' });
  return `Deleted at ${time} on ${day}`;
}

/** When the clean-up runs, as the page explains it: "10:00 PM". */
export function cleanupTimeLabel(cleanupTime: string): string {
  const [hours, minutes] = cleanupTime.split(':').map(Number);
  const at = new Date(Date.UTC(2000, 0, 1, hours ?? 22, minutes ?? 0));
  return at.toLocaleTimeString(undefined, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
}

/** "How long files are kept", in words: "24 hours", "1 hour", "3 days". */
export function retentionLabel(hours: number): string {
  if (hours % 24 === 0 && hours >= 48) return `${hours / 24} days`;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** "120 MB of 500 MB used", or "120 MB used" with no cap. */
export function usageLabel(usedBytes: number, storageBytes: number | null): string {
  if (storageBytes === null) return `${formatFileSize(usedBytes)} used`;
  return `${formatFileSize(usedBytes)} of ${formatFileSize(storageBytes)} used`;
}

/** The share of the room used, 0…1, for the bar. Null with no cap. */
export function usageFraction(usedBytes: number, storageBytes: number | null): number | null {
  if (storageBytes === null || storageBytes <= 0) return null;
  return Math.min(usedBytes / storageBytes, 1);
}

/**
 * Why this file cannot be uploaded, before a byte is sent — or null. The
 * server checks every one again, and words the cap's refusal with the plan.
 */
export function checkUploadDraft(
  file: { name: string; size: number } | null,
  room: { maxFileBytes: number; storageBytes: number | null; usedBytes: number },
  sharing: { visibility: string; sharedWith: readonly string[] },
): string | null {
  if (!file) return 'Choose a file to upload.';
  if (file.size <= 0) return 'An empty file cannot be uploaded.';
  if (typeof prepareFileName(file.name) !== 'string')
    return 'That file’s name cannot be kept. Rename it and try again.';
  if (file.size > room.maxFileBytes) {
    return `That file is ${formatFileSize(file.size)}. Files here can be at most ${formatFileSize(room.maxFileBytes)}.`;
  }
  if (room.storageBytes !== null && room.usedBytes + file.size > room.storageBytes) {
    const left = Math.max(room.storageBytes - room.usedBytes, 0);
    return `Only ${formatFileSize(left)} of room is left here. Delete a file, or wait for tonight’s clean-up.`;
  }
  if (sharing.visibility === 'people' && sharing.sharedWith.length === 0) {
    return 'Choose at least one person to share it with, or make it private.';
  }
  return null;
}

/**
 * What a file looks like it is, for its icon and tint. Read from the declared
 * type first, then the name's extension (a browser often declares nothing).
 * ⚠ Only ever a picture: the server never trusts either to serve the file.
 */
export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'sheet' | 'slides' | 'archive' | 'other';

const EXTENSION_KINDS: Readonly<Record<string, FileKind>> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  heic: 'image',
  heif: 'image',
  svg: 'image',
  bmp: 'image',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  m4v: 'video',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  aac: 'audio',
  flac: 'audio',
  pdf: 'pdf',
  doc: 'document',
  docx: 'document',
  odt: 'document',
  rtf: 'document',
  txt: 'document',
  md: 'document',
  kwdoc: 'document',
  xls: 'sheet',
  xlsx: 'sheet',
  ods: 'sheet',
  csv: 'sheet',
  tsv: 'sheet',
  ppt: 'slides',
  pptx: 'slides',
  odp: 'slides',
  key: 'slides',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
};

export function fileKindOf(contentType: string, name: string): FileKind {
  const type = contentType.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return EXTENSION_KINDS[extension] ?? 'other';
}

/** The three ways to narrow the list. */
export type FileFilter = 'all' | 'mine' | 'shared';

export const FILE_FILTERS: readonly { value: FileFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'shared', label: 'Shared with me' },
];

/** How many files each filter shows, for the chips' counts. */
export function fileFilterCounts(files: readonly { mine: boolean }[]): Record<FileFilter, number> {
  const mine = files.filter((file) => file.mine).length;
  return { all: files.length, mine, shared: files.length - mine };
}

/**
 * The files a filter and a search show, in the list's order. The search
 * matches the name and the owner's name, ignoring case and accents, so
 * "resume" finds "Résumé.pdf".
 */
export function filterFiles<T extends { mine: boolean; name: string; ownerName: string | null }>(
  files: readonly T[],
  filter: FileFilter,
  search: string,
): T[] {
  const needle = folded(search.trim());
  return files.filter((file) => {
    if (filter === 'mine' && !file.mine) return false;
    if (filter === 'shared' && file.mine) return false;
    if (!needle) return true;
    return folded(file.name).includes(needle) || folded(file.ownerName ?? '').includes(needle);
  });
}

function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * When the clean-up takes the file, said the way a person would, in the
 * workspace's zone: "Deleted tonight at 10 PM", "Deleted tomorrow at 10 PM",
 * else the date. `soon` is true for tonight, so the page can mark it.
 */
export function deletionWhen(
  createdAt: string,
  retentionHours: number,
  timeZone: string,
  cleanupTime: string,
  now: Date,
): { label: string; soon: boolean } {
  const at = fileDeletionAt(new Date(createdAt), retentionHours, timeZone, cleanupTime);
  if (!at) return { label: 'Deleted by the nightly clean-up', soon: false };
  const time = at.toLocaleTimeString(undefined, { timeZone, hour: 'numeric', minute: '2-digit' });
  const day = zonedDayKey(at, timeZone);
  const today = zonedDayKey(now, timeZone);
  if (day === today) return { label: `Deleted tonight at ${time}`, soon: true };
  if (day === nextDayKey(today)) return { label: `Deleted tomorrow at ${time}`, soon: false };
  const date = at.toLocaleDateString(undefined, { timeZone, weekday: 'short', day: 'numeric', month: 'short' });
  return { label: `Deleted ${date} at ${time}`, soon: false };
}

/** "Today, 3:04 PM", "Yesterday, 9:12 AM", or "Mon, 16 Nov": when it was uploaded, in the workspace's zone. */
export function uploadedLabel(createdAt: string, timeZone: string, now: Date): string {
  const at = new Date(createdAt);
  const time = at.toLocaleTimeString(undefined, { timeZone, hour: 'numeric', minute: '2-digit' });
  const day = zonedDayKey(at, timeZone);
  const today = zonedDayKey(now, timeZone);
  if (day === today) return `Today, ${time}`;
  if (nextDayKey(day) === today) return `Yesterday, ${time}`;
  return at.toLocaleDateString(undefined, { timeZone, weekday: 'short', day: 'numeric', month: 'short' });
}

/** "You", or the owner's name, or a fallback for somebody who has left. */
export function ownerLabel(file: { mine: boolean; ownerName: string | null }): string {
  if (file.mine) return 'You';
  return file.ownerName ?? 'A former member';
}

/** What an empty list says, and what to do next: by filter, and whether a search emptied it. */
export function emptyListWords(
  filter: FileFilter,
  searching: boolean,
  canWrite: boolean,
): { title: string; detail: string } {
  if (searching) {
    return {
      title: 'No files match that search',
      detail: 'Try part of the name, or the name of the person who uploaded it.',
    };
  }
  const detail = canWrite
    ? 'Upload a file and choose who can see it. It stays until the nightly clean-up.'
    : 'Files shared with you here appear in this list.';
  switch (filter) {
    case 'mine':
      return { title: 'You have not uploaded anything', detail };
    case 'shared':
      return { title: 'Nothing is shared with you yet', detail: 'Files other people share with you appear here.' };
    case 'all':
      return { title: 'No files yet', detail };
  }
}
