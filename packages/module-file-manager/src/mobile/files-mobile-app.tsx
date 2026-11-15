'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { BottomSheet, BottomSheetRow, ConfirmDialog } from '@kwtech/web-ui/react';
import { Download, Plus, Settings, Share2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FILE_LIST_MAX, formatFileSize } from '../domain/files.js';
import { buttonClass } from '../react/components/controls.js';
import { downloadFile } from '../react/components/file-actions.js';
import { FileKindIcon } from '../react/components/file-kind-icon.js';
import { DeletionNote, SharingBadge } from '../react/components/file-row.js';
import { FileEmpty, FileSkeleton, FileToolbar } from '../react/components/file-toolbar.js';
import { SettingsPanel } from '../react/components/settings-panel.js';
import { useShareDraft } from '../react/components/share-draft.js';
import { SharingFields } from '../react/components/sharing-fields.js';
import { StorageSummary } from '../react/components/storage-summary.js';
import { UploadFields, useUploadDraft } from '../react/components/upload-panel.js';
import { ErrorBanner } from '../react/file-app.js';
import type { FileClient, FileEntryView, FileSettingsView } from '../react/file-client.js';
import { type FilesState, useFiles } from '../react/use-files.js';
import { deletionWhen, type FileFilter, fileFilterCounts, filterFiles, ownerLabel } from '../react/view/files-view.js';

/**
 * Files on a phone (issue #142): the same `useFiles` as the Apps page — the
 * same files, rules and live updates — arranged for a thumb, as Tasks and
 * Notes are:
 *
 *   - the storage and tonight's clean-up as cards at the top;
 *   - search, and All · Mine · Shared with me as chips with counts;
 *   - the files as CARDS that flex: one column on a phone, two on a wide
 *     phone or a tablet, long names wrapping rather than cut;
 *   - a round ＋ that opens the upload as a BOTTOM SHEET (the operator,
 *     2026-11-15): the phone's picker, who sees it, the progress;
 *   - a file tapped opens its actions as a sheet: Download, and the owner's
 *     Share and Delete.
 */
export interface FilesMobileAppProps extends AppProps {
  /** Injectable, for tests and previews. */
  client?: FileClient;
}

export function FilesMobileApp({ organizationId, workspaceId, client }: FilesMobileAppProps) {
  const state = useFiles(organizationId, workspaceId, client ? { client } : {});
  const timeZone = useWorkspaceTimeZone();
  const [sheet, setSheet] = useState<'upload' | 'settings' | null>(null);
  const [opened, setOpened] = useState<FileEntryView | null>(null);
  const [sharing, setSharing] = useState<FileEntryView | null>(null);
  const [deleting, setDeleting] = useState<FileEntryView | null>(null);
  const [filter, setFilter] = useState<FileFilter>('all');
  const [search, setSearch] = useState('');
  const { files, settings } = state;
  const now = new Date();

  const shown = useMemo(() => (files ? filterFiles(files, filter, search) : null), [files, filter, search]);
  const counts = useMemo(() => fileFilterCounts(files ?? []), [files]);

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    const target = deleting;
    await state.run(async (api) => {
      await api.delete(state.scope, target.id);
    });
    setDeleting(null);
  }

  return (
    <div className="@container flex h-full flex-col">
      {!state.live ? (
        <p role="status" className="shrink-0 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
          Not live — new files show when you reload.
        </p>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-3 px-4 pt-4 pb-28">
            <div className="flex items-center gap-2">
              <h1 className="min-w-0 flex-1 text-xl font-semibold tracking-tight">Files</h1>
              {state.canManage && settings ? (
                <button
                  type="button"
                  onClick={() => setSheet('settings')}
                  aria-label="File settings"
                  className="grid size-11 place-items-center rounded-2xl bg-muted text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-accent"
                >
                  <Settings aria-hidden className="size-[1.125rem]" />
                </button>
              ) : null}
            </div>

            {settings ? <StorageSummary settings={settings} compact /> : null}

            <FileToolbar search={search} onSearch={setSearch} filter={filter} onFilter={setFilter} counts={counts} />

            <ErrorBanner state={state} />

            {shown === null || !settings ? <FileSkeleton /> : null}
            {shown && settings && shown.length === 0 ? (
              <FileEmpty
                searching={search.trim() !== ''}
                canWrite={state.canWrite}
                filter={filter}
                action={
                  state.canWrite ? (
                    <button type="button" className={buttonClass('primary')} onClick={() => setSheet('upload')}>
                      <Plus aria-hidden className="size-4" />
                      Upload a file
                    </button>
                  ) : undefined
                }
              />
            ) : null}
            {shown && settings && shown.length > 0 ? (
              // Flexible: one column on a phone, two once the box has room (a wide phone, a tablet).
              <ul className="grid gap-2 @lg:grid-cols-2">
                {shown.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    settings={settings}
                    timeZone={timeZone}
                    now={now}
                    onOpen={() => setOpened(file)}
                  />
                ))}
              </ul>
            ) : null}
            {files && files.length >= FILE_LIST_MAX ? (
              <p className="text-xs text-muted-foreground">
                Showing the newest {FILE_LIST_MAX} files. Older ones are still here until tonight’s clean-up.
              </p>
            ) : null}
          </div>
        </div>

        {state.canWrite && settings ? (
          <button
            type="button"
            onClick={() => setSheet('upload')}
            className="absolute right-4 bottom-4 inline-flex min-h-14 items-center gap-2 rounded-full bg-primary pr-5 pl-4 text-base font-semibold text-primary-foreground shadow-lg transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
          >
            <Plus aria-hidden className="size-5" />
            Upload
          </button>
        ) : null}
      </div>

      {settings ? (
        <UploadSheet
          // Remounted per opening, so a closed sheet never keeps a half-chosen file.
          key={sheet === 'upload' ? 'open' : 'closed'}
          open={sheet === 'upload'}
          state={state}
          settings={settings}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {settings ? (
        <BottomSheet open={sheet === 'settings'} onClose={() => setSheet(null)} title="File settings">
          <div className="flex flex-col gap-3">
            <ErrorBanner state={state} />
            <SettingsPanel state={state} settings={settings} onDone={() => setSheet(null)} bare />
          </div>
        </BottomSheet>
      ) : null}

      <FileActionsSheet
        file={opened}
        state={state}
        settings={settings}
        timeZone={timeZone}
        now={now}
        onClose={() => setOpened(null)}
        onShare={(file) => {
          setOpened(null);
          setSharing(file);
        }}
        onDelete={(file) => {
          setOpened(null);
          setDeleting(file);
        }}
      />

      {sharing ? <ShareSheet key={sharing.id} file={sharing} state={state} onClose={() => setSharing(null)} /> : null}

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

/** One file as a card: a large target that opens its actions. */
function FileCard({
  file,
  settings,
  timeZone,
  now,
  onOpen,
}: {
  file: FileEntryView;
  settings: FileSettingsView;
  timeZone: string;
  now: Date;
  onOpen: () => void;
}) {
  const deletion = deletionWhen(file.createdAt, settings.retentionHours, timeZone, settings.cleanupTime, now);
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 rounded-2xl border border-border/70 bg-card p-3 text-left shadow-sm transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
      >
        <FileKindIcon contentType={file.contentType} name={file.name} />
        <span className="min-w-0 flex-1">
          {/* Wrapped, never cut: on a phone the name is what tells two files apart. */}
          <span className="line-clamp-2 text-[0.9375rem] font-medium [overflow-wrap:anywhere]">{file.name}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {formatFileSize(file.sizeBytes)} · {ownerLabel(file)}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <SharingBadge file={file} />
            <DeletionNote deletion={deletion} />
          </span>
        </span>
      </button>
    </li>
  );
}

/** A file's actions: what it is, then Download, and the owner's Share and Delete. */
function FileActionsSheet({
  file,
  state,
  settings,
  timeZone,
  now,
  onClose,
  onShare,
  onDelete,
}: {
  file: FileEntryView | null;
  state: FilesState;
  settings: FileSettingsView | null;
  timeZone: string;
  now: Date;
  onClose: () => void;
  onShare: (file: FileEntryView) => void;
  onDelete: (file: FileEntryView) => void;
}) {
  const canChange = Boolean(file?.mine) && state.canWrite;
  const deletion =
    file && settings
      ? deletionWhen(file.createdAt, settings.retentionHours, timeZone, settings.cleanupTime, now)
      : null;
  return (
    <BottomSheet open={file !== null} onClose={onClose} title={file?.name ?? 'File'}>
      {file ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3">
            <FileKindIcon contentType={file.contentType} name={file.name} size="lg" />
            <div className="min-w-0 text-sm">
              <p className="text-muted-foreground">
                {formatFileSize(file.sizeBytes)} · {ownerLabel(file)}
              </p>
              <div className="mt-1">
                <SharingBadge file={file} />
              </div>
              {deletion ? <DeletionNote deletion={deletion} className="mt-1" /> : null}
            </div>
          </div>
          <div className="flex flex-col">
            <BottomSheetRow
              icon={<Download className="size-5" />}
              label="Download"
              detail="Saves it to this phone"
              disabled={state.busy}
              onClick={() => {
                void downloadFile(state, file);
                onClose();
              }}
            />
            {canChange ? (
              <>
                <BottomSheetRow
                  icon={<Share2 className="size-5" />}
                  label="Share"
                  detail="Change who can see it"
                  onClick={() => onShare(file)}
                />
                <BottomSheetRow
                  icon={<Trash2 className="size-5" />}
                  label="Delete"
                  detail="For everybody it is shared with"
                  tone="danger"
                  onClick={() => onDelete(file)}
                />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </BottomSheet>
  );
}

/** The upload, as a sheet: the picker, who sees it, the progress, and the buttons kept in view below. */
function UploadSheet({
  open,
  state,
  settings,
  onClose,
}: {
  open: boolean;
  state: FilesState;
  settings: FileSettingsView;
  onClose: () => void;
}) {
  const draft = useUploadDraft(state, settings, onClose);
  return (
    <BottomSheet
      open={open}
      onClose={() => {
        // A sheet is not swiped away mid-upload: the bytes are still leaving.
        if (!draft.uploading) onClose();
      }}
      title="Upload a file"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass('secondary', 'min-h-12 flex-1 rounded-xl')}
            onClick={onClose}
            disabled={draft.uploading}
          >
            Cancel
          </button>
          <button
            type="button"
            className={buttonClass('primary', 'min-h-12 flex-1 rounded-xl')}
            onClick={() => void draft.submit()}
            disabled={draft.uploading || !draft.file}
          >
            {draft.uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* The sheet covers the page's banner: a refusal from the server is shown here too. */}
        <ErrorBanner state={state} />
        <UploadFields draft={draft} settings={settings} members={state.members} />
      </div>
    </BottomSheet>
  );
}

/** Re-sharing one of your files, as a sheet. */
function ShareSheet({ file, state, onClose }: { file: FileEntryView; state: FilesState; onClose: () => void }) {
  const draft = useShareDraft(state, file, onClose);
  return (
    <BottomSheet
      open
      onClose={onClose}
      title={`Share “${file.name}”`}
      footer={
        <div className="flex gap-2">
          <button type="button" className={buttonClass('secondary', 'min-h-12 flex-1 rounded-xl')} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={buttonClass('primary', 'min-h-12 flex-1 rounded-xl')}
            onClick={() => void draft.save()}
            disabled={state.busy}
          >
            {state.busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <ErrorBanner state={state} />
        <SharingFields
          draft={draft.sharing}
          members={state.members}
          onChange={draft.setSharing}
          disabled={state.busy}
        />
        {draft.problem ? (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {draft.problem}
          </p>
        ) : null}
      </div>
    </BottomSheet>
  );
}
