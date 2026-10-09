'use client';

import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import {
  ConfirmDialog,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@kwtech/web-ui/react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  History,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
  Users,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useId, useState } from 'react';
import { NOTE_APPEARANCE_LABELS, NOTE_COLORS, type NoteLook, normalizeNoteColor } from '../../domain/appearance.js';
import { normalizeNoteTitle, noteDisplayTitle } from '../../domain/notes.js';
import type { NoteRevisionView } from '../note-client.js';
import type { NotesState } from '../use-notes.js';
import { notePaperColor } from '../view/appearance.js';
import { type NoteMode, noteOpensIn, parseTagField } from '../view/editing.js';
import { noteLinesStyle } from './paper.js';
import { ProblemBanner } from './problem-banner.js';

/** The parser is only needed to read a note, and it is ESM-only — loaded on demand. */
const NoteMarkdown = lazy(async () => ({ default: (await import('./note-markdown.js')).NoteMarkdown }));

/**
 * The open note: its title on the top rule, the body, tags, colour and the
 * save status in the footer ("Saved · p. 3 of 12").
 *
 * ⚠ A NOTE OPENS TO BE READ (`noteOpensIn`): the rendered text, no inputs.
 * The Edit button opens its fields; Done saves and goes back to reading.
 *
 * Read-only for good — no Edit button — in the trash, and for somebody
 * without `note:write`. The API would refuse the edit anyway; this only stops
 * the screen from offering it.
 */
/** Page-turning, while the notes list is collapsed. Absent while the list is on screen. */
export interface NotePager {
  previous: (() => void) | null;
  next: (() => void) | null;
}

export function NotePage({ state, look, pager }: { state: NotesState; look: NoteLook; pager?: NotePager | undefined }) {
  const { editor } = state;
  const note = editor.note;
  const draft = editor.draft;
  const titleId = useId();
  const tagsId = useId();
  const bodyId = useId();
  const [mode, setMode] = useState<NoteMode>('read');
  const [tagField, setTagField] = useState('');
  const [confirm, setConfirm] = useState<'unshare' | 'delete' | null>(null);
  const [revisions, setRevisions] = useState<NoteRevisionView[] | null>(null);

  const noteId = note?.id ?? null;
  // A different note opened: show its tags, close anything open for the last one, and start it in its own mode —
  // never the last note's, or reading one note after editing another would open it for writing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the note, not on every save of it.
  useEffect(() => {
    setMode(note ? noteOpensIn(note) : 'read');
    setTagField(note ? note.tags.join(', ') : '');
    setRevisions(null);
    setConfirm(null);
  }, [noteId]);

  if (!note || !draft) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {state.ordered.length > 0 ? 'Choose a note from the index.' : 'Your notes will open here.'}
      </div>
    );
  }

  const trashed = note.trashedAt !== null;
  /** May be edited at all. Whether its fields are open right now is `editing`. */
  const editable = state.canWrite && !trashed;
  const editing = editable && mode === 'edit';
  const shared = note.visibility === 'workspace';
  const canBin = note.mine || (shared && state.canManageAll);
  const position = state.ordered.findIndex((row) => row.id === note.id);
  const total = `${state.ordered.length}${state.list?.nextCursor ? '+' : ''}`;

  const openRevisions = async () => {
    setRevisions((await state.client.revisions(state.scope, note.id).catch(() => null)) ?? []);
  };

  return (
    <article aria-labelledby={titleId} className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-3 pt-2 font-sans">
        <div className="ml-auto flex items-center gap-1">
          {editable ? (
            // Named, not an icon alone: it is the one way into the note's fields, and has to be found.
            <button
              type="button"
              onClick={() => {
                // Done is a moment the text is meant to be kept: saved now, not when the autosave next comes round.
                if (editing) void editor.flush();
                setMode(editing ? 'read' : 'edit');
              }}
              className={cn(iconButton, 'gap-1 px-2 text-sm', editing && 'text-primary')}
            >
              {editing ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Pencil aria-hidden="true" className="size-4" />
              )}
              {editing ? 'Done' : 'Edit'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void state.setPinned(note.id, !note.pinned)}
            aria-pressed={note.pinned}
            className={iconButton}
          >
            {note.pinned ? (
              <PinOff aria-hidden="true" className="size-4" />
            ) : (
              <Pin aria-hidden="true" className="size-4" />
            )}
            <span className="sr-only">{note.pinned ? 'Unpin' : 'Pin to top'}</span>
          </button>
          {note.mine && editable ? (
            // The hint says what sharing MEANS: everyone in this workspace, not chosen
            // people — and they can edit it. Read out after the name, too.
            <Tooltip text={shared ? SHARED_HINT : SHARE_HINT} align="end">
              {(tooltip) => (
                <button
                  type="button"
                  onClick={() => (shared ? setConfirm('unshare') : void state.setShared(true))}
                  aria-pressed={shared}
                  disabled={state.busy}
                  className={cn(iconButton, 'gap-1 px-2 text-sm', shared && 'text-primary')}
                  {...tooltip}
                >
                  <Users aria-hidden="true" className="size-4" />
                  {shared ? 'Shared' : 'Share'}
                </button>
              )}
            </Tooltip>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger className={iconButton} aria-label="More actions">
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {shared ? (
                <DropdownMenuItem onSelect={() => void openRevisions()}>
                  <History aria-hidden="true" className="size-4" /> Earlier versions
                </DropdownMenuItem>
              ) : null}
              {canBin && !trashed && state.canWrite ? (
                <DropdownMenuItem onSelect={() => void state.trash()}>
                  <Trash2 aria-hidden="true" className="size-4" /> Move to trash
                </DropdownMenuItem>
              ) : null}
              {canBin && trashed && state.canWrite ? (
                <>
                  <DropdownMenuItem onSelect={() => void state.restore()}>
                    <RotateCcw aria-hidden="true" className="size-4" /> Restore
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setConfirm('delete')} className="text-destructive">
                    <Trash2 aria-hidden="true" className="size-4" /> Delete forever
                  </DropdownMenuItem>
                </>
              ) : null}
              {!shared && !(canBin && state.canWrite) ? (
                <DropdownMenuItem disabled>Nothing else to do here</DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ProblemBanner state={state} />

      {trashed ? (
        <p role="status" className="mx-3 mt-1 rounded-md bg-muted px-2 py-1 font-sans text-sm text-muted-foreground">
          In the trash. Restore it to edit it again.
        </p>
      ) : null}

      <div className="px-3">
        <label htmlFor={titleId} className="sr-only">
          Title
        </label>
        {editing ? (
          <input
            id={titleId}
            value={draft.title}
            onChange={(event) => editor.edit({ title: event.target.value })}
            onBlur={() => void editor.flush()}
            placeholder="Untitled"
            className="w-full bg-transparent text-[1.35em] font-semibold leading-(--note-rule) placeholder:text-muted-foreground/60 focus-visible:outline-none"
          />
        ) : (
          <h2 id={titleId} className="text-[1.35em] font-semibold leading-(--note-rule)">
            {/* From what is on screen: just after Done the save may not be back yet, and the note's own title is the old one. */}
            {noteDisplayTitle({ title: normalizeNoteTitle(draft.title), body: draft.body })}
          </h2>
        )}
      </div>

      {revisions ? (
        <Revisions
          revisions={revisions}
          canRestore={editable}
          onRestore={(id) => {
            setRevisions(null);
            void state.restoreRevision(id);
          }}
          onClose={() => setRevisions(null)}
        />
      ) : !editing ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 leading-(--note-rule)" style={noteLinesStyle(look)}>
          {draft.body.trim() ? (
            <Suspense fallback={<p className="text-muted-foreground">Opening…</p>}>
              <NoteMarkdown body={draft.body} />
            </Suspense>
          ) : (
            <p className="text-muted-foreground">Nothing written yet.</p>
          )}
        </div>
      ) : (
        <>
          <label htmlFor={bodyId} className="sr-only">
            Note
          </label>
          <textarea
            id={bodyId}
            value={draft.body}
            onChange={(event) => editor.edit({ body: event.target.value })}
            onBlur={() => void editor.flush()}
            placeholder="Write here. Markdown works: # headings, - lists, **bold**."
            spellCheck
            className="min-h-0 flex-1 resize-none bg-transparent px-3 leading-(--note-rule) placeholder:text-muted-foreground/60 focus-visible:outline-none"
            style={noteLinesStyle(look)}
          />
        </>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-border/60 px-3 py-1.5 font-sans text-xs text-muted-foreground">
        {editing ? (
          <>
            <label htmlFor={tagsId} className="sr-only">
              Tags, separated by commas
            </label>
            <input
              id={tagsId}
              value={tagField}
              onChange={(event) => {
                setTagField(event.target.value);
                editor.edit({ tags: parseTagField(event.target.value) });
              }}
              onBlur={() => void editor.flush()}
              placeholder="Tags, with commas"
              className="min-w-24 flex-1 rounded-sm bg-transparent px-1 py-0.5 hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
            <ColorDots value={draft.color} onChange={(color) => editor.edit({ color })} />
          </>
        ) : (
          <span className="flex-1 truncate">{note.tags.map((tag) => `#${tag}`).join(' ')}</span>
        )}
        <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
          <span role="status" aria-live="polite">
            {statusLabel(editor.status, trashed)}
            {position >= 0 && !pager ? ` · p. ${position + 1} of ${total}` : ''}
          </span>
          {pager ? (
            // Turning the page: the list is collapsed, so this is the way to the next note.
            <>
              <span aria-hidden="true">·</span>
              <PageTurn direction="previous" onTurn={pager.previous} />
              {position >= 0 ? <span>{`p. ${position + 1} of ${total}`}</span> : null}
              <PageTurn direction="next" onTurn={pager.next} />
            </>
          ) : null}
        </span>
      </footer>

      <ConfirmDialog
        open={confirm === 'unshare'}
        title="Stop sharing this note?"
        description="Everyone else in this workspace loses it straight away — including anything they wrote in it."
        confirmLabel="Stop sharing"
        pending={state.busy}
        onConfirm={() => {
          setConfirm(null);
          void state.setShared(false);
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this note forever?"
        description="It cannot be brought back, and nor can its earlier versions."
        confirmLabel="Delete forever"
        pending={state.busy}
        onConfirm={() => {
          setConfirm(null);
          void state.deleteForever();
        }}
        onCancel={() => setConfirm(null)}
      />
    </article>
  );
}

/** One page-turn button, with the themed hint above it (the footer is at the page's bottom edge). */
function PageTurn({ direction, onTurn }: { direction: 'previous' | 'next'; onTurn: (() => void) | null }) {
  const label = direction === 'previous' ? 'Previous note' : 'Next note';
  return (
    <Tooltip text={label} side="top" align={direction === 'previous' ? 'start' : 'end'}>
      {(tooltip) => (
        <button
          type="button"
          onClick={() => onTurn?.()}
          disabled={!onTurn}
          aria-label={label}
          className="inline-flex size-6 items-center justify-center rounded-md hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent"
          {...tooltip}
        >
          {direction === 'previous' ? (
            <ChevronLeft aria-hidden="true" className="size-4" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-4" />
          )}
        </button>
      )}
    </Tooltip>
  );
}

const SHARE_HINT = 'Share with everyone in this workspace. They can read and edit it.';
const SHARED_HINT = 'Shared with everyone in this workspace. Click to make it private again.';

const iconButton =
  'inline-flex h-7 min-w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60';

function statusLabel(status: 'saved' | 'unsaved' | 'saving', trashed: boolean): string {
  if (trashed) return 'In the trash';
  switch (status) {
    case 'saving':
      return 'Saving…';
    case 'unsaved':
      return 'Not saved yet';
    case 'saved':
      return 'Saved';
  }
}

/** The note's colour: dots showing each tint as it will look on this theme. */
function ColorDots({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const current = normalizeNoteColor(value);
  return (
    <fieldset className="flex items-center gap-1">
      <legend className="sr-only">Note colour</legend>
      {NOTE_COLORS.map((color) => (
        <Tooltip key={color} text={NOTE_APPEARANCE_LABELS.color[color]} describes={false}>
          {(tooltip) => (
            <button
              type="button"
              onClick={() => onChange(color)}
              aria-pressed={color === current}
              className={cn(
                'size-4 rounded-full border border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                color === current && 'ring-2 ring-primary ring-offset-1 ring-offset-card',
              )}
              style={{ backgroundColor: notePaperColor(color, 'strong') }}
              {...tooltip}
            >
              <span className="sr-only">{NOTE_APPEARANCE_LABELS.color[color]}</span>
            </button>
          )}
        </Tooltip>
      ))}
    </fieldset>
  );
}

/** A shared note's earlier versions: who wrote each, and a way to put one back. */
function Revisions({
  revisions,
  canRestore,
  onRestore,
  onClose,
}: {
  revisions: NoteRevisionView[];
  canRestore: boolean;
  onRestore: (id: string) => void;
  onClose: () => void;
}) {
  // The workspace's clock, so everyone reading the history sees the same times.
  const timeZone = useWorkspaceTimeZone();
  return (
    <section aria-label="Earlier versions" className="min-h-0 flex-1 overflow-y-auto px-3 font-sans text-sm">
      <div className="flex items-center justify-between py-1">
        <h3 className="font-medium">Earlier versions</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-primary underline underline-offset-2 hover:no-underline"
        >
          Back to the note
        </button>
      </div>
      {revisions.length === 0 ? (
        <p className="text-muted-foreground">
          None yet. A version is kept whenever somebody saves over another person’s writing.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {revisions.map((revision) => (
            <li key={revision.id} className="rounded-md border border-border/60 bg-background/60 p-2">
              <p className="text-xs text-muted-foreground">
                Written by {revision.editedByName ?? 'a member'} · replaced{' '}
                {new Date(revision.createdAt).toLocaleString(undefined, { timeZone })}
              </p>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap">{revision.body || 'Nothing written.'}</p>
              {canRestore ? (
                <button
                  type="button"
                  onClick={() => onRestore(revision.id)}
                  className="mt-1 text-primary underline underline-offset-2 hover:no-underline"
                >
                  Restore this version
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
