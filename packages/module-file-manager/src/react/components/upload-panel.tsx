'use client';

import { cn } from '@kwtech/web-ui/react';
import { CloudUpload } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { formatFileSize } from '../../domain/files.js';
import type { FilePersonView, FileSettingsView } from '../file-client.js';
import type { FilesState } from '../use-files.js';
import { checkUploadDraft } from '../view/files-view.js';
import { buttonClass } from './controls.js';
import { FileKindIcon } from './file-kind-icon.js';
import { type SharingDraft, SharingFields } from './sharing-fields.js';

export interface UploadDraft {
  file: File | null;
  choose(file: File | null): void;
  sharing: SharingDraft;
  setSharing(sharing: SharingDraft): void;
  problem: string | null;
  /** 0…1 while the bytes are leaving; null otherwise. */
  progress: number | null;
  uploading: boolean;
  submit(): Promise<void>;
}

/**
 * One upload's state, apart from where it is drawn: the desktop's panel and a
 * phone's bottom sheet hold the same draft, checked by the same
 * `checkUploadDraft` the server agrees with.
 */
export function useUploadDraft(
  state: FilesState,
  settings: FileSettingsView,
  onDone: () => void,
  initialFile: File | null = null,
): UploadDraft {
  const [file, setFile] = useState<File | null>(initialFile);
  const [sharing, setSharing] = useState<SharingDraft>({ visibility: 'private', sharedWith: [] });
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  async function submit(): Promise<void> {
    const refusal = checkUploadDraft(file, settings, sharing);
    setProblem(refusal);
    if (refusal || !file) return;
    setProgress(0);
    const sent = await state.run((api) =>
      api.upload(state.scope, { file, ...sharing, onProgress: (fraction) => setProgress(fraction) }),
    );
    setProgress(null);
    if (sent) onDone();
  }

  return {
    file,
    choose(next) {
      setFile(next);
      setProblem(null);
    },
    sharing,
    setSharing,
    problem,
    progress,
    uploading: progress !== null,
    submit,
  };
}

/**
 * The upload's fields: a large target to choose a file (or drop one, on a
 * desktop), the chosen file as a card, who sees it, and the progress.
 * Without buttons: the panel and the sheet each place their own.
 */
export function UploadFields({
  draft,
  settings,
  members,
  droppable = false,
}: {
  draft: UploadDraft;
  settings: FileSettingsView;
  members: readonly FilePersonView[];
  /** Says a file can be dropped: on a desktop, never in a phone's sheet. */
  droppable?: boolean;
}) {
  const inputId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { file, uploading, progress } = draft;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* The real input, hidden: the target below opens it, and its label names it. */}
      <input
        ref={input}
        id={inputId}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="File to upload"
        disabled={uploading}
        aria-describedby={hintId}
        onChange={(event) => {
          draft.choose(event.target.files?.[0] ?? null);
          // Cleared, so choosing the same file again after "Change" still fires.
          event.target.value = '';
        }}
      />
      {file ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <FileKindIcon contentType={file.type} name={file.name} />
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">{file.name}</p>
            <p id={hintId} className="text-xs text-muted-foreground">
              {formatFileSize(file.size)}
            </p>
          </div>
          <button
            type="button"
            className={buttonClass('ghost')}
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            Change
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            draft.choose(event.dataTransfer.files[0] ?? null);
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            over ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60 hover:bg-accent/40',
          )}
        >
          <span aria-hidden className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <CloudUpload className="size-6" />
          </span>
          <span className="text-sm font-medium">Choose a file</span>
          <span id={hintId} className="text-xs text-muted-foreground">
            Any kind of file, up to {formatFileSize(settings.maxFileBytes)}.{droppable ? ' Or drop it here.' : ''}
          </span>
        </button>
      )}
      <SharingFields draft={draft.sharing} members={members} onChange={draft.setSharing} disabled={uploading} />
      {draft.problem ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {draft.problem}
        </p>
      ) : null}
      {progress !== null ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <span>Uploading…</span>
            <span className="tabular-nums text-muted-foreground">{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The desktop's upload: the fields in a card under the header, with its own buttons. */
export function UploadPanel({
  state,
  settings,
  members,
  initialFile,
  onDone,
}: {
  state: FilesState;
  settings: FileSettingsView;
  members: readonly FilePersonView[];
  initialFile?: File | null;
  onDone: () => void;
}) {
  const draft = useUploadDraft(state, settings, onDone, initialFile ?? null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void draft.submit();
      }}
      className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm"
    >
      <h2 className="text-base font-semibold">Upload a file</h2>
      <UploadFields draft={draft} settings={settings} members={members} droppable />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonClass('ghost')} onClick={onDone} disabled={draft.uploading}>
          Cancel
        </button>
        <button type="submit" className={buttonClass('primary')} disabled={draft.uploading || !draft.file}>
          {draft.uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>
    </form>
  );
}
