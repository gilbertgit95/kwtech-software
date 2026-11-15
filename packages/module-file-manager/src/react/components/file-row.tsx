'use client';

import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import { Download, EllipsisVertical, Lock, Share2, Trash2, UserRoundCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { formatFileSize } from '../../domain/files.js';
import type { FileEntryView, FilePersonView, FileSettingsView } from '../file-client.js';
import type { FilesState } from '../use-files.js';
import { deletionWhen, ownerLabel, sharingLabel, uploadedLabel } from '../view/files-view.js';
import { buttonClass } from './controls.js';
import { downloadFile } from './file-actions.js';
import { FileKindIcon } from './file-kind-icon.js';
import { useShareDraft } from './share-draft.js';
import { SharingFields } from './sharing-fields.js';

/**
 * The columns of the list in a WIDE box (`@3xl`): name, sharing, size, when
 * it goes, actions. Shared with the header row in `FileApp`, so the two
 * cannot drift apart.
 */
export const FILE_ROW_COLUMNS = '@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_13rem_5.5rem_13rem_9.5rem] @3xl:items-center';

/** The sharing as a small badge: an icon and a word, never colour alone. */
export function SharingBadge({ file }: { file: FileEntryView }) {
  const Icon = file.visibility === 'private' ? Lock : file.visibility === 'workspace' ? Users : UserRoundCheck;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs',
        file.visibility === 'private' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{sharingLabel(file)}</span>
    </span>
  );
}

/**
 * When the clean-up takes it. Tonight is a warning badge, so a file about to
 * go stands out in a long list; later is quiet text.
 */
export function DeletionNote({
  deletion,
  className,
}: {
  deletion: { label: string; soon: boolean };
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center text-xs',
        deletion.soon
          ? 'rounded-full bg-status-warning px-2 py-0.5 font-medium text-status-warning-foreground'
          : 'text-muted-foreground',
        className,
      )}
    >
      {deletion.label}
    </span>
  );
}

/**
 * One file on the desktop: a row of columns in a wide box, a two-line card in
 * a narrow one. Download is always one click; Share and Delete (the owner's)
 * sit behind ⋯, so a long list stays calm.
 */
export function FileRow({
  file,
  state,
  settings,
  members,
  timeZone,
  now,
  onDelete,
}: {
  file: FileEntryView;
  state: FilesState;
  settings: FileSettingsView;
  members: readonly FilePersonView[];
  timeZone: string;
  now: Date;
  onDelete: (file: FileEntryView) => void;
}) {
  const [sharing, setSharing] = useState(false);
  const deletion = deletionWhen(file.createdAt, settings.retentionHours, timeZone, settings.cleanupTime, now);
  const canChange = file.mine && state.canWrite;

  return (
    <li className="group border-b border-border/70 last:border-b-0">
      <div className={cn('flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/40', FILE_ROW_COLUMNS)}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <FileKindIcon contentType={file.contentType} name={file.name} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={file.name}>
              {file.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {ownerLabel(file)} · {uploadedLabel(file.createdAt, timeZone, now)}
              {/* Narrow box only: the wide one has columns for these. */}
              <span className="@3xl:hidden"> · {formatFileSize(file.sizeBytes)}</span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 @3xl:hidden">
              <SharingBadge file={file} />
              <DeletionNote deletion={deletion} />
            </div>
          </div>
        </div>
        <div className="hidden min-w-0 @3xl:block">
          <SharingBadge file={file} />
        </div>
        <p className="hidden text-sm tabular-nums text-muted-foreground @3xl:block">{formatFileSize(file.sizeBytes)}</p>
        <div className="hidden min-w-0 @3xl:block">
          <DeletionNote deletion={deletion} />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1">
          <button
            type="button"
            className={buttonClass('secondary')}
            onClick={() => void downloadFile(state, file)}
            disabled={state.busy}
            aria-label={`Download ${file.name}`}
          >
            <Download aria-hidden className="size-4" />
            <span className="hidden @lg:inline">Download</span>
          </button>
          {canChange ? (
            <DropdownMenu>
              <DropdownMenuTrigger className={buttonClass('ghost', 'px-2')} aria-label={`More for ${file.name}`}>
                <EllipsisVertical aria-hidden className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setSharing(true)}>
                  <Share2 aria-hidden />
                  Share…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete(file)}>
                  <Trash2 aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            // The ⋯'s room, kept: every row's Download stays in one column.
            <span aria-hidden className="size-8 shrink-0" />
          )}
        </div>
      </div>
      {sharing ? <ShareEditor file={file} state={state} members={members} onDone={() => setSharing(false)} /> : null}
    </li>
  );
}

/** Re-sharing, opened in place under its row: the desktop's version of a phone's share sheet. */
function ShareEditor({
  file,
  state,
  members,
  onDone,
}: {
  file: FileEntryView;
  state: FilesState;
  members: readonly FilePersonView[];
  onDone: () => void;
}) {
  const draft = useShareDraft(state, file, onDone);
  return (
    <div className="mx-3 mb-3 flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/30 p-4">
      <h3 className="text-sm font-semibold">Share “{file.name}”</h3>
      <SharingFields draft={draft.sharing} members={members} onChange={draft.setSharing} disabled={state.busy} />
      {draft.problem ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {draft.problem}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClass('ghost')} onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className={buttonClass('primary')}
          onClick={() => void draft.save()}
          disabled={state.busy}
        >
          {state.busy ? 'Saving…' : 'Save sharing'}
        </button>
      </div>
    </div>
  );
}
