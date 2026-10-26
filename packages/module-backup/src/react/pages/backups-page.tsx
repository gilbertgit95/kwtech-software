'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { ConfirmDialog, cn } from '@kwtech/web-ui/react';
import { DatabaseBackup, Download, LoaderCircle, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { BACKUP_FEATURE } from '../../feature-keys.js';
import type { BackupFileView } from '../../types.js';
import type { BackupClient } from '../backup-client.js';
import { useBackups } from '../use-backups.js';
import {
  BACKUP_KIND_LABELS,
  formatBackupSize,
  keptLine,
  restoreCommand,
  totalBackupSize,
} from '../view/backups-view.js';

export interface BackupsPageProps {
  client?: BackupClient;
  /** Where the daily backup's schedule is changed: the runner's page. */
  processesHref?: string;
  /** Where a restore sends the browser, once everybody has been signed out. */
  signInHref?: string;
}

/**
 * Database → Backups (issue #2): the server's backup folder, as a list, and
 * what may be done with each file. Every control checks its own key, so
 * somebody who may only look sees the list and none of the buttons — and the
 * API checks again.
 *
 * Times are in the viewer's own zone: this is a page outside any workspace.
 */
export function BackupsPage({
  client,
  processesHref = '/admin/processes',
  signInHref = '/auth/signin',
}: BackupsPageProps = {}) {
  const state = useBackups(client ? { client } : {});
  const canCreate = useHoldsFeature(BACKUP_FEATURE.create);
  const canDownload = useHoldsFeature(BACKUP_FEATURE.download);
  const canDelete = useHoldsFeature(BACKUP_FEATURE.delete);
  const canRestore = useHoldsFeature(BACKUP_FEATURE.restore);
  const [deleting, setDeleting] = useState<BackupFileView | null>(null);
  const [restoring, setRestoring] = useState<BackupFileView | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const view = state.view;
  const files = view?.files ?? [];
  const running = view !== null && view.activity !== 'idle';

  async function backUpNow() {
    setStatus(null);
    if (await state.run((api) => api.create())) setStatus('Backed up.');
  }

  async function download(file: BackupFileView) {
    setStatus(null);
    // The address is asked for at the click, never rendered ahead: a ticket lasts a minute and is spent on use.
    await state.run(async (api) => {
      window.location.assign(await api.downloadUrl(file.name));
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Backups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Full copies of the database in the server’s backup folder. Each one holds every row, password hashes
            included — keep downloaded copies private.
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={state.busy || running || view === null}
            onClick={() => void backUpNow()}
          >
            {view?.activity === 'backing_up' ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <DatabaseBackup aria-hidden="true" className="size-4" />
            )}
            {view?.activity === 'backing_up' ? 'Backing up…' : 'Back up now'}
          </button>
        ) : null}
      </header>

      {state.error ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{state.error}</span>
          <button type="button" className="shrink-0 font-medium underline" onClick={state.dismissError}>
            Dismiss
          </button>
        </div>
      ) : null}
      {status ? (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      ) : null}

      {view ? (
        <section className="rounded-lg border border-border bg-card p-4 text-sm">
          <ul className="flex flex-col gap-1 text-muted-foreground">
            <li>
              {keptLine(files.length, view.keep)} {formatBackupSize(totalBackupSize(files))} in all.
            </li>
            <li>
              A backup is made every day at 9:00 PM ({view.timeZone}).{' '}
              <a className="underline hover:text-foreground" href={processesHref}>
                Change or pause it on the Processes page
              </a>
              .
            </li>
          </ul>
        </section>
      ) : null}

      <section aria-label="Backups in the folder" className="rounded-lg border border-border">
        {view === null ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : files.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No backups yet. {canCreate ? 'Back up now makes the first one.' : ''}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {files.map((file) => (
              <li key={file.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-mono text-sm">{file.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(file.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                    {formatBackupSize(file.sizeBytes)} · {BACKUP_KIND_LABELS[file.kind]}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {canDownload ? (
                    <button
                      type="button"
                      className={buttonClass('secondary', 'sm')}
                      disabled={state.busy}
                      onClick={() => void download(file)}
                    >
                      <Download aria-hidden="true" className="size-3.5" />
                      Download
                    </button>
                  ) : null}
                  {canRestore ? (
                    <button
                      type="button"
                      className={buttonClass('secondary', 'sm')}
                      disabled={state.busy || running}
                      onClick={() => setRestoring(file)}
                    >
                      <RotateCcw aria-hidden="true" className="size-3.5" />
                      Restore
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      type="button"
                      aria-label={`Delete ${file.name}`}
                      className={buttonClass('danger', 'sm')}
                      disabled={state.busy || view.activity === 'restoring'}
                      onClick={() => setDeleting(file)}
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this backup?"
        description={
          <>
            <span className="font-mono">{deleting?.name}</span> is deleted from the server’s backup folder. It cannot be
            brought back.
          </>
        }
        confirmLabel="Delete backup"
        pending={state.busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const file = deleting;
          if (!file) return;
          void state
            .run((api) => api.remove(file.name))
            .then((done) => {
              setDeleting(null);
              if (done) setStatus(`Deleted ${file.name}.`);
            });
        }}
      />

      <RestoreDialog
        file={restoring}
        database={view?.database ?? ''}
        pending={state.busy}
        onCancel={() => setRestoring(null)}
        onRestore={async (confirmation, password) => {
          const file = restoring;
          if (!file) return;
          const done = await state.run((api) => api.restore(file.name, confirmation, password));
          // Everybody was signed out, this browser included: the next page is the sign-in.
          if (done) window.location.assign(signInHref);
        }}
      />
    </div>
  );
}

/**
 * ⚠ THE ONE ACT HERE THAT CANNOT BE UNDONE BY THE PAGE. It asks for the
 * database's name typed out and the caller's password, and says what happens
 * in the order it happens. The safety backup is the way back, and it is made
 * by the server before anything changes.
 */
function RestoreDialog({
  file,
  database,
  pending,
  onCancel,
  onRestore,
}: {
  file: BackupFileView | null;
  database: string;
  pending: boolean;
  onCancel: () => void;
  onRestore: (confirmation: string, password: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirmId = useId();
  const passwordId = useId();
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const open = file !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
    if (!open) {
      setConfirmation('');
      setPassword('');
    }
  }, [open]);

  const ready = confirmation.trim() === database && password.length > 0 && !pending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready) void onRestore(confirmation, password);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${confirmId}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      className={cn(
        // `m-auto` is the centring Preflight takes away (see web-ui's ConfirmDialog).
        'm-auto w-full max-w-lg rounded-lg border border-border bg-card p-0 text-card-foreground shadow-lg',
        'max-h-[calc(100dvh-4rem)] overflow-y-auto backdrop:bg-black/40',
      )}
    >
      <form className="flex flex-col gap-4 p-6" onSubmit={submit}>
        <h2 id={`${confirmId}-title`} className="flex items-center gap-2 text-base font-semibold">
          <TriangleAlert aria-hidden="true" className="size-5 text-destructive" />
          Restore the database from this backup?
        </h2>
        <p className="font-mono text-sm break-all">{file?.name}</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>A safety backup of the database as it is now is made first. That is the way back.</li>
          <li>While it restores, nobody can use the app. It usually takes under a minute.</li>
          <li>
            The whole database becomes this backup:{' '}
            <strong className="text-foreground">everything since is lost</strong> — every organization’s.
          </li>
          <li>Everybody is signed out, you included.</li>
        </ol>
        <div className="flex flex-col gap-1">
          <label htmlFor={confirmId} className="text-sm font-medium">
            Type <span className="font-mono">{database}</span> to confirm
          </label>
          <input
            id={confirmId}
            autoComplete="off"
            spellCheck={false}
            className="h-9 rounded-md border border-input bg-background px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={passwordId} className="text-sm font-medium">
            Your password
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Or restore from the command line on the server</summary>
          <code className="mt-2 block rounded bg-muted px-2 py-1.5 font-mono break-all text-foreground">
            {file ? restoreCommand(file.name) : ''}
          </code>
        </details>
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass('secondary')} disabled={pending} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={buttonClass('destructive')} disabled={!ready}>
            {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
            {pending ? 'Restoring…' : 'Restore and sign everybody out'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'destructive';

/** The runner's button shapes (module-jobs), copied: a component moves to web-ui only with a second consumer. */
function buttonClass(variant: ButtonVariant, size: 'sm' | 'md' = 'md'): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
    variant === 'primary' && 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
    variant === 'secondary' && 'border border-border bg-background text-foreground shadow-sm hover:bg-muted',
    variant === 'danger' &&
      'border border-destructive/30 bg-background text-destructive shadow-sm hover:bg-destructive/10',
    variant === 'destructive' && 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
  );
}
