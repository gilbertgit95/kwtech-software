'use client';

import type { FileEntryView } from '../file-client.js';
import type { FilesState } from '../use-files.js';

/**
 * Downloads one file. The address is asked for at the click, never rendered
 * ahead: a ticket lasts a minute and is spent on use.
 *
 * ⚠ A link clicked, never `location.assign`: a sub-app must not navigate, and
 * an attachment does not leave the page.
 */
export async function downloadFile(state: FilesState, file: Pick<FileEntryView, 'id' | 'name'>): Promise<void> {
  await state.run(async (api) => {
    const href = await api.downloadUrl(state.scope, file.id);
    const link = document.createElement('a');
    link.href = href;
    link.download = file.name;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  });
}
