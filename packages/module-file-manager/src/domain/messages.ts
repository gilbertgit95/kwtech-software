import type { FileRefusal } from '../types.js';
import { FILE_NAME_MAX, FILE_SHARE_PEOPLE_MAX } from './files.js';
import { FILE_RETENTION_HOURS_MAX, FILE_RETENTION_HOURS_MIN } from './retention.js';

/**
 * ⚠ ONE SENTENCE for a file that does not exist, is another workspace's, or is
 * not shared with you. Any difference, even in wording, tells a prober which
 * of the three they hit.
 */
export const FILE_NOT_FOUND_MESSAGE = 'That file is not here — it may have been deleted, or it is not shared with you.';

/**
 * The sentence for each refusal, shared by the server, the web app's route
 * handlers and the page. A cap's refusal (`file_too_large`, `storage_full`)
 * is worded by module-kit's `limitReachedText` where the plan is known; this
 * is the fallback.
 */
export function fileRefusalMessage(reason: FileRefusal): string {
  switch (reason) {
    case 'not_found':
      return FILE_NOT_FOUND_MESSAGE;
    case 'not_owner':
      return 'Only the person who uploaded a file can share or delete it.';
    case 'not_permitted':
      return 'You do not have access to files in this workspace.';
    case 'invalid_name':
      return `A file needs a name of at most ${FILE_NAME_MAX} characters, with no invisible formatting.`;
    case 'invalid_size':
      return 'An empty file cannot be uploaded.';
    case 'invalid_visibility':
      return 'A file is private, shared with the workspace, or shared with chosen people.';
    case 'invalid_people':
      return 'Choose at least one person to share it with, or make it private.';
    case 'too_many_people':
      return `A file can be shared with at most ${FILE_SHARE_PEOPLE_MAX} people by name — share it with the workspace instead.`;
    case 'not_shareable':
      return 'Somebody on that list is not a member here who can see files.';
    case 'invalid_retention':
      return `Files can be kept from ${FILE_RETENTION_HOURS_MIN} to ${FILE_RETENTION_HOURS_MAX} hours (a week).`;
    case 'file_too_large':
      return 'That file is larger than one file can be here.';
    case 'storage_full':
      return 'There is not enough room left for that file here. Delete a file, or wait for tonight’s clean-up.';
    case 'size_mismatch':
      return 'The file did not arrive whole. Try uploading it again.';
    case 'ticket_invalid':
      return 'That link has expired. Start the upload or download again.';
    case 'too_many_transfers':
      return 'You have started a lot of uploads and downloads in the last few minutes. Wait a few minutes, then try again.';
    case 'not_configured':
      return 'Files are not set up on this server yet. Ask the person who runs it to set FILES_DIR.';
  }
}
