'use client';

import { useId, useState } from 'react';
import { formatFileSize } from '../../domain/files.js';
import type { FilePersonView, FileSettingsView } from '../file-client.js';
import type { FilesState } from '../use-files.js';
import { checkUploadDraft } from '../view/files-view.js';
import { buttonClass } from './controls.js';
import { type SharingDraft, SharingFields } from './sharing-fields.js';

/** Choose a file, choose who sees it, send it — with progress, because a large file takes a while. */
export function UploadPanel({
  state,
  settings,
  members,
  onDone,
}: {
  state: FilesState;
  settings: FileSettingsView;
  members: readonly FilePersonView[];
  onDone: () => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [sharing, setSharing] = useState<SharingDraft>({ visibility: 'private', sharedWith: [] });
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
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

  const uploading = progress !== null;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-base font-semibold">Upload a file</h2>
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          File
        </label>
        <input
          id={inputId}
          type="file"
          disabled={uploading}
          aria-describedby={hintId}
          aria-invalid={problem ? true : undefined}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setProblem(null);
          }}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm"
        />
        <p id={hintId} className="text-xs text-muted-foreground">
          {file
            ? `${file.name} · ${formatFileSize(file.size)}`
            : `Any kind of file, up to ${formatFileSize(settings.maxFileBytes)}.`}
        </p>
      </div>
      <SharingFields draft={sharing} members={members} onChange={setSharing} disabled={uploading} />
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      {uploading ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-1 text-sm">
          <span>Uploading… {Math.round(progress * 100)}%</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonClass('ghost')} onClick={onDone} disabled={uploading}>
          Cancel
        </button>
        <button type="submit" className={buttonClass('primary')} disabled={uploading || !file}>
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>
    </form>
  );
}
