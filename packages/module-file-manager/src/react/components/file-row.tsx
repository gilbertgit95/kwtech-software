'use client';

import { Download, FileText, Share2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatFileSize } from '../../domain/files.js';
import type { FileEntryView, FilePersonView, FileSettingsView } from '../file-client.js';
import type { FilesState } from '../use-files.js';
import { deletionLabel, sharingLabel } from '../view/files-view.js';
import { buttonClass } from './controls.js';
import { type SharingDraft, SharingFields } from './sharing-fields.js';

/** One file: what it is, whose, who sees it, when it goes — and what you may do with it. */
export function FileRow({
  file,
  state,
  settings,
  members,
  timeZone,
  onDelete,
}: {
  file: FileEntryView;
  state: FilesState;
  settings: FileSettingsView;
  members: readonly FilePersonView[];
  timeZone: string;
  onDelete: (file: FileEntryView) => void;
}) {
  const [sharing, setSharing] = useState<SharingDraft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const owner = file.mine ? 'You' : (file.ownerName ?? 'A former member');

  async function download(): Promise<void> {
    // The address is asked for at the click, never rendered ahead: a ticket lasts a minute and is spent on use.
    await state.run(async (api) => {
      const href = await api.downloadUrl(state.scope, file.id);
      // ⚠ A link clicked, never `location.assign`: a sub-app must not navigate, and an attachment does not.
      const link = document.createElement('a');
      link.href = href;
      link.download = file.name;
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
    });
  }

  async function saveSharing(): Promise<void> {
    if (!sharing) return;
    if (sharing.visibility === 'people' && sharing.sharedWith.length === 0) {
      setProblem('Choose at least one person to share it with, or make it private.');
      return;
    }
    setProblem(null);
    const ok = await state.run(async (api) => {
      await api.setSharing(state.scope, file.id, sharing);
    });
    if (ok) setSharing(null);
  }

  return (
    <li className="flex flex-col gap-3 border-b border-border py-3 last:border-b-0">
      <div className="flex flex-col gap-2 @md:flex-row @md:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <FileText aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={file.name}>
              {file.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(file.sizeBytes)} · {owner} · {sharingLabel(file)}
            </p>
            <p className="text-xs text-muted-foreground">
              {deletionLabel(file.createdAt, settings.retentionHours, timeZone, settings.cleanupTime)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1 @md:justify-end">
          <button type="button" className={buttonClass('secondary')} onClick={download} disabled={state.busy}>
            <Download aria-hidden className="size-4" />
            Download
          </button>
          {file.mine && state.canWrite ? (
            <>
              <button
                type="button"
                className={buttonClass('ghost')}
                aria-expanded={sharing !== null}
                onClick={() =>
                  setSharing(
                    sharing ? null : { visibility: file.visibility, sharedWith: file.sharedWith.map((p) => p.userId) },
                  )
                }
              >
                <Share2 aria-hidden className="size-4" />
                Share…
              </button>
              <button
                type="button"
                className={buttonClass('danger')}
                aria-label={`Delete ${file.name}`}
                onClick={() => onDelete(file)}
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </>
          ) : null}
        </div>
      </div>
      {sharing ? (
        <div className="ml-8 flex flex-col gap-3 rounded-md border border-border p-3">
          <SharingFields draft={sharing} members={members} onChange={setSharing} disabled={state.busy} />
          {problem ? (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass('ghost')} onClick={() => setSharing(null)}>
              Cancel
            </button>
            <button type="button" className={buttonClass('primary')} onClick={saveSharing} disabled={state.busy}>
              Save sharing
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
