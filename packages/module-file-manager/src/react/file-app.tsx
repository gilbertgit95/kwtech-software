'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { ConfirmDialog, cn } from '@kwtech/web-ui/react';
import { CloudUpload, Folder, Settings, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FILE_LIST_MAX } from '../domain/files.js';
import { buttonClass } from './components/controls.js';
import { FILE_ROW_COLUMNS, FileRow } from './components/file-row.js';
import { FileEmpty, FileSkeleton, FileToolbar } from './components/file-toolbar.js';
import { SettingsPanel } from './components/settings-panel.js';
import { StorageSummary } from './components/storage-summary.js';
import { UploadPanel } from './components/upload-panel.js';
import type { FileClient, FileEntryView } from './file-client.js';
import { type FilesState, useFiles } from './use-files.js';
import { type FileFilter, fileFilterCounts, filterFiles } from './view/files-view.js';

export interface FileAppProps extends AppProps {
  /** Injectable, for tests. */
  client?: FileClient;
}

/**
 * The file manager as a SUB-APP on the workspace's Apps page (issues #138, #142).
 *
 * - Laid out by the BOX's width (`@container`), never the viewport's: a grid
 *   cell is narrow on a wide screen. Wide, the list is a table; narrow, cards.
 * - It never navigates: upload, sharing and settings open in place, and a
 *   download is a link clicked, which an attachment does not leave the page for.
 * - A file dragged anywhere onto the app starts an upload with it chosen.
 * - Every file shows when the nightly clean-up deletes it, in the WORKSPACE's
 *   time zone, so nobody is surprised when it goes.
 *
 * A phone gets its own screen (`FilesMobileApp`) over the same `useFiles`.
 */
export function FileApp({ organizationId, workspaceId, client }: FileAppProps) {
  const state = useFiles(organizationId, workspaceId, client ? { client } : {});
  const timeZone = useWorkspaceTimeZone();
  const [panel, setPanel] = useState<'none' | 'upload' | 'settings'>('none');
  const [dropped, setDropped] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<FileEntryView | null>(null);
  const [filter, setFilter] = useState<FileFilter>('all');
  const [search, setSearch] = useState('');
  const { files, settings } = state;
  // Read once per render: every row's "today" and "tonight" agree.
  const now = new Date();

  const shown = useMemo(() => (files ? filterFiles(files, filter, search) : null), [files, filter, search]);
  const counts = useMemo(() => fileFilterCounts(files ?? []), [files]);

  function openUpload(file: File | null): void {
    setDropped(file);
    setPanel('upload');
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    const target = deleting;
    await state.run(async (api) => {
      await api.delete(state.scope, target.id);
    });
    setDeleting(null);
  }

  const canDrop = state.canWrite && settings !== null && panel !== 'upload';

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dropping is a shortcut; the Upload button does the same.
    <div
      className="@container relative flex h-full w-full flex-col overflow-y-auto"
      onDragOver={(event) => {
        if (!canDrop || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        setDragging(false);
        if (!canDrop) return;
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) openUpload(file);
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 @3xl:p-6">
        <header className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-sm"
          >
            <Folder className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
            <p className="text-sm text-muted-foreground">Share files with your workspace. They are temporary.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {state.canManage ? (
              <button
                type="button"
                className={buttonClass('secondary')}
                aria-expanded={panel === 'settings'}
                onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
              >
                <Settings aria-hidden className="size-4" />
                <span className="hidden @md:inline">Settings</span>
                <span className="sr-only @md:hidden">File settings</span>
              </button>
            ) : null}
            {state.canWrite ? (
              <button
                type="button"
                className={buttonClass('primary')}
                aria-expanded={panel === 'upload'}
                onClick={() => (panel === 'upload' ? setPanel('none') : openUpload(null))}
              >
                <Upload aria-hidden className="size-4" />
                Upload
              </button>
            ) : null}
          </div>
        </header>

        {settings ? <StorageSummary settings={settings} /> : null}

        <ErrorBanner state={state} />

        {!state.live ? (
          <p role="status" className="text-xs text-muted-foreground">
            Not live: other people’s uploads show when this list is read again.
          </p>
        ) : null}

        {panel === 'upload' && settings ? (
          <UploadPanel
            // A new dropped file starts a new draft.
            key={dropped ? `${dropped.name}-${dropped.size}-${dropped.lastModified}` : 'picked'}
            state={state}
            settings={settings}
            members={state.members}
            initialFile={dropped}
            onDone={() => setPanel('none')}
          />
        ) : null}
        {panel === 'settings' && settings ? (
          <SettingsPanel state={state} settings={settings} onDone={() => setPanel('none')} />
        ) : null}

        <FileToolbar search={search} onSearch={setSearch} filter={filter} onFilter={setFilter} counts={counts} />

        <section aria-label="Files" className="min-h-0">
          {shown === null || !settings ? <FileSkeleton /> : null}
          {shown && settings && shown.length === 0 ? (
            <FileEmpty
              searching={search.trim() !== ''}
              canWrite={state.canWrite}
              filter={filter}
              action={
                state.canWrite ? (
                  <button type="button" className={buttonClass('primary')} onClick={() => openUpload(null)}>
                    <Upload aria-hidden className="size-4" />
                    Upload a file
                  </button>
                ) : undefined
              }
            />
          ) : null}
          {shown && settings && shown.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
              {/* Column headings, in a wide box only: a narrow one shows cards. */}
              <div
                aria-hidden
                className={cn(
                  'hidden border-b border-border/70 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground',
                  FILE_ROW_COLUMNS,
                )}
              >
                <span className="pl-[3.25rem]">Name</span>
                <span>Who can see it</span>
                <span>Size</span>
                <span>Deleted</span>
                <span className="sr-only">Actions</span>
              </div>
              <ul className="flex flex-col">
                {shown.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    state={state}
                    settings={settings}
                    members={state.members}
                    timeZone={timeZone}
                    now={now}
                    onDelete={setDeleting}
                  />
                ))}
              </ul>
            </div>
          ) : null}
          {files && files.length >= FILE_LIST_MAX ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing the newest {FILE_LIST_MAX} files. Older ones are still here until tonight’s clean-up.
            </p>
          ) : null}
        </section>
      </div>

      {dragging ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-2 z-10 flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-primary bg-background/85 backdrop-blur-sm"
        >
          <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <CloudUpload className="size-7" />
          </span>
          <p className="text-base font-semibold">Drop to upload</p>
          <p className="text-sm text-muted-foreground">You choose who can see it next.</p>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this file?"
        description={
          deleting ? `“${deleting.name}” will be deleted for everybody it is shared with. This cannot be undone.` : ''
        }
        confirmLabel="Delete file"
        danger
        pending={state.busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

/** The last refusal, with its reason and a way to dismiss it. Shared with the phone's screen. */
export function ErrorBanner({ state }: { state: FilesState }) {
  if (!state.error) return null;
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <span className="min-w-0">{state.error}</span>
      <button type="button" className={buttonClass('ghost', 'shrink-0')} onClick={state.dismissError}>
        Dismiss
      </button>
    </div>
  );
}
