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
