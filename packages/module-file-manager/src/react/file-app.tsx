'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { ConfirmDialog } from '@kwtech/web-ui/react';
import { Settings, Upload } from 'lucide-react';
import { useState } from 'react';
import { FILE_LIST_MAX } from '../domain/files.js';
import { buttonClass } from './components/controls.js';
import { FileRow } from './components/file-row.js';
import { SettingsPanel } from './components/settings-panel.js';
import { UploadPanel } from './components/upload-panel.js';
import type { FileClient, FileEntryView } from './file-client.js';
import { useFiles } from './use-files.js';
import { cleanupTimeLabel, retentionLabel, usageFraction, usageLabel } from './view/files-view.js';

export interface FileAppProps extends AppProps {
  /** Injectable, for tests. */
  client?: FileClient;
}

/**
 * The file manager as a SUB-APP on the workspace's Apps page (issue #138).
 *
 * - Laid out by the BOX's width (`@container`), never the viewport's: a grid
 *   cell is narrow on a wide screen.
 * - It never navigates: upload, sharing and settings open in place, and a
 *   download is a link clicked, which an attachment does not leave the page for.
 * - Every file shows when the nightly clean-up deletes it, in the WORKSPACE's
 *   time zone, so nobody is surprised when it goes.
 */
export function FileApp({ organizationId, workspaceId, client }: FileAppProps) {
  const state = useFiles(organizationId, workspaceId, client ? { client } : {});
  const timeZone = useWorkspaceTimeZone();
  const [panel, setPanel] = useState<'none' | 'upload' | 'settings'>('none');
  const [deleting, setDeleting] = useState<FileEntryView | null>(null);
  const { files, settings } = state;

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    const target = deleting;
    await state.run(async (api) => {
      await api.delete(state.scope, target.id);
    });
    setDeleting(null);
  }

  const fraction = settings ? usageFraction(settings.usedBytes, settings.storageBytes) : null;

  return (
    <div className="@container flex h-full w-full flex-col gap-4 p-4">
      <header className="flex flex-col gap-3 @lg:flex-row @lg:items-start @lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {settings
              ? `Files here are temporary: every night at ${cleanupTimeLabel(settings.cleanupTime)}, files older than ${retentionLabel(settings.retentionHours)} are deleted.`
              : 'Files here are temporary: the nightly clean-up deletes them.'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {state.canManage ? (
            <button
              type="button"
              className={buttonClass('ghost')}
              aria-expanded={panel === 'settings'}
              onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
            >
              <Settings aria-hidden className="size-4" />
              Settings
            </button>
          ) : null}
          {state.canWrite ? (
            <button
              type="button"
              className={buttonClass('primary')}
              aria-expanded={panel === 'upload'}
              onClick={() => setPanel(panel === 'upload' ? 'none' : 'upload')}
            >
              <Upload aria-hidden className="size-4" />
              Upload
            </button>
          ) : null}
        </div>
      </header>

      {settings ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">{usageLabel(settings.usedBytes, settings.storageBytes)}</p>
          {fraction !== null ? (
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              // Decorative: the sentence above says the same in words.
              aria-hidden
            >
              <div
                className={fraction >= 0.9 ? 'h-full bg-status-warning' : 'h-full bg-primary'}
                style={{ width: `${Math.round(fraction * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {state.error ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          <span>{state.error}</span>
          <button type="button" className={buttonClass('ghost')} onClick={state.dismissError}>
            Dismiss
          </button>
        </div>
      ) : null}

      {!state.live ? (
        <p className="text-xs text-muted-foreground">
          Not live: other people’s uploads show when this list is read again.
        </p>
      ) : null}

      {panel === 'upload' && settings ? (
        <UploadPanel state={state} settings={settings} members={state.members} onDone={() => setPanel('none')} />
      ) : null}
      {panel === 'settings' && settings ? (
        <SettingsPanel state={state} settings={settings} onDone={() => setPanel('none')} />
      ) : null}

      <section aria-label="Files" className="min-h-0 flex-1">
        {files === null || !settings ? <p className="text-sm text-muted-foreground">Loading files…</p> : null}
        {files?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {state.canWrite
              ? 'No files yet. Upload one, and choose who can see it.'
              : 'No files have been shared with you here.'}
          </p>
        ) : null}
        {files && files.length > 0 && settings ? (
          <ul className="flex flex-col">
            {files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                state={state}
                settings={settings}
                members={state.members}
                timeZone={timeZone}
                onDelete={setDeleting}
              />
            ))}
          </ul>
        ) : null}
        {files && files.length >= FILE_LIST_MAX ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing the newest {FILE_LIST_MAX} files. Older ones are still here until tonight’s clean-up.
          </p>
        ) : null}
      </section>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this file?"
        description={
          deleting ? `“${deleting.name}” will be deleted for everybody it is shared with. This cannot be undone.` : ''
        }
        confirmLabel="Delete file"
        pending={state.busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
