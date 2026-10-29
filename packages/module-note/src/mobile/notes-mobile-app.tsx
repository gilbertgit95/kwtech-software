'use client';

import { type AppProps, zonedDayKey } from '@kwtech/module-kit';
import { useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { BottomSheet, BottomSheetRow, ConfirmDialog, cn } from '@kwtech/web-ui/react';
import {
  Check,
  ChevronLeft,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useId, useState } from 'react';
import { NOTE_APPEARANCE_LABELS, NOTE_COLORS, normalizeNoteColor } from '../domain/appearance.js';
import { normalizeNoteTitle, noteDisplayTitle } from '../domain/notes.js';
import { ProblemBanner } from '../react/components/problem-banner.js';
import type { NoteSummaryView, NoteTab } from '../react/note-client.js';
import { type NotesState, useNotes } from '../react/use-notes.js';
import { notePaperColor } from '../react/view/appearance.js';
import { noteOpensIn, parseTagField } from '../react/view/editing.js';

const NoteMarkdown = lazy(async () => ({
  default: (await import('../react/components/note-markdown.js')).NoteMarkdown,
}));

const TABS: readonly { tab: NoteTab; label: string }[] = [
  { tab: 'all', label: 'All' },
  { tab: 'mine', label: 'Mine' },
  { tab: 'shared', label: 'Shared' },
  { tab: 'trash', label: 'Trash' },
];

/**
 * Notes on a phone (issue #22): a list, then one note full screen — not the
 * desktop app squeezed into a phone, whose two panes, index tabs and hover
 * tools made a poor fit for a thumb (the operator, 2026-10-29).
 *
 * The same `useNotes` and `useNoteEditor` as the Apps page's notes: the same
 * list, the same autosave and conflict handling, the same keys, live. What
 * differs is the arrangement:
 *
 *   - the LIST — search, All / Mine / Shared / Trash, tags, pinned first —
 *     with a round ＋ to start a note;
 *   - a NOTE full screen, with "‹ Notes", Read / Edit, and its actions (pin,
 *     share, colour, trash) in a sheet from the bottom.
 *
 * A note is open exactly when the editor holds one. Going back is
 * `editor.open(null)`, which saves first and stays — with the problem shown —
 * when it cannot, so nothing typed is lost by leaving.
 */
export function NotesMobileApp({ organizationId, workspaceId }: AppProps) {
  const state = useNotes(organizationId, workspaceId);
  return state.editor.note ? <NoteScreen state={state} /> : <NoteList state={state} />;
}

// ── the list ──────────────────────────────────────────────────────────────

function NoteList({ state }: { state: NotesState }) {
  const searchId = useId();
  const pinned = state.list?.pinned ?? [];
  const notes = state.list?.notes ?? [];
  const tags = state.list?.tags ?? [];
  const trash = state.tab === 'trash';
  const empty = state.list !== null && pinned.length === 0 && notes.length === 0;

  return (
    <div className="relative h-full">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-4 px-4 pt-4 pb-28">
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">
              Search notes
            </label>
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id={searchId}
              type="search"
              value={state.search}
              onChange={(event) => state.setSearch(event.target.value)}
              placeholder="Search notes"
              // 16px: an iPhone zooms the page in on a smaller field.
              className="min-h-11 w-full rounded-2xl border border-border/70 bg-card pr-3 pl-10 text-base text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <Chips
            label="Which notes"
            options={TABS.map(({ tab, label }) => ({ value: tab, label }))}
            value={state.tab}
            onChange={(tab) => state.setTab(tab)}
          />

          {tags.length > 0 && !trash ? (
            <Chips
              label="Tag"
              small
              options={[{ value: '', label: 'Any tag' }, ...tags.map((tag) => ({ value: tag, label: `#${tag}` }))]}
              value={state.tag ?? ''}
              onChange={(tag) => state.setTag(tag || null)}
            />
          ) : null}

          {!state.canWrite ? (
            <p role="status" className="rounded-2xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              You can read notes here, but your role or your organization’s plan does not include writing them.
            </p>
          ) : null}
          <ErrorLine state={state} />

          {state.list === null ? (
            <ul aria-label="Loading" className="space-y-2">
              {[0, 1, 2].map((key) => (
                <li key={key} className="h-24 animate-pulse rounded-2xl bg-muted" />
              ))}
            </ul>
          ) : null}

          {pinned.length > 0 ? (
            <Section title="Pinned">
              {pinned.map((note) => (
                <NoteCard key={note.id} note={note} onOpen={() => void state.editor.open(note.id)} />
              ))}
            </Section>
          ) : null}
          {notes.length > 0 ? (
            <Section title={pinned.length > 0 ? 'Notes' : null}>
              {notes.map((note) => (
                <NoteCard key={note.id} note={note} onOpen={() => void state.editor.open(note.id)} />
              ))}
            </Section>
          ) : null}

          {state.list?.nextCursor ? (
            <button
              type="button"
              onClick={() => void state.loadMore()}
              disabled={state.busy}
              className="min-h-11 w-full rounded-full bg-muted text-sm font-medium text-foreground active:bg-accent disabled:opacity-50"
            >
              Show more
            </button>
          ) : null}

          {empty ? (
            <div className="rounded-3xl border border-border/70 bg-card px-6 py-10 text-center shadow-sm">
              <h2 className="text-base font-semibold text-foreground">{emptyTitle(state)}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{emptyBody(state)}</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* A new note: the one thing this screen is for, always in reach of a thumb. */}
      {state.canWrite && !trash ? (
        <button
          type="button"
          onClick={() => void state.createNote()}
          disabled={state.busy}
          aria-label="New note"
          className="absolute right-4 bottom-4 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Plus aria-hidden className="size-6" />
        </button>
      ) : null}
    </div>
  );
}

function NoteCard({ note, onOpen }: { note: NoteSummaryView; onOpen: () => void }) {
  const timeZone = useWorkspaceTimeZone();
  const color = normalizeNoteColor(note.color);
  const shared = note.visibility === 'workspace';
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        // The note's colour as the card's wash, as the paper is on the full site.
        style={color === 'default' ? undefined : { backgroundColor: notePaperColor(color) }}
        className="flex w-full flex-col gap-1 rounded-2xl border border-border/70 bg-card p-4 text-left shadow-sm transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-[0.9375rem] font-semibold leading-snug text-card-foreground">
            {note.displayTitle}
          </span>
          {note.pinned ? <Pin aria-label="Pinned" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : null}
        </span>
        {note.preview ? <span className="line-clamp-2 text-sm text-muted-foreground">{note.preview}</span> : null}
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <time dateTime={note.updatedAt}>{whenLabel(note.updatedAt, timeZone)}</time>
          {shared ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              <Users aria-hidden className="size-3" /> Shared
            </span>
          ) : null}
          {!note.mine && note.authorName ? <span>by {note.authorName}</span> : null}
          {note.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </span>
      </button>
    </li>
  );
}

// ── one note ──────────────────────────────────────────────────────────────

function NoteScreen({ state }: { state: NotesState }) {
  const { editor } = state;
  const note = editor.note;
  const draft = editor.draft;
  const titleId = useId();
  const bodyId = useId();
  const tagsId = useId();
  const [editing, setEditing] = useState(false);
  const [tagField, setTagField] = useState('');
  const [actions, setActions] = useState(false);
  const [confirm, setConfirm] = useState<'unshare' | 'delete' | null>(null);

  const noteId = note?.id ?? null;
  // Another note opened: its own mode (a blank note opens for writing) and its own tags.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the note, not on every save of it.
  useEffect(() => {
    setEditing(note ? noteOpensIn(note) === 'edit' : false);
    setTagField(note ? note.tags.join(', ') : '');
    setActions(false);
    setConfirm(null);
  }, [noteId]);

  if (!note || !draft) return null;

  const trashed = note.trashedAt !== null;
  const editable = state.canWrite && !trashed;
  const isEditing = editable && editing;
  const shared = note.visibility === 'workspace';
  const canBin = note.mine || (shared && state.canManageAll);
  const color = normalizeNoteColor(draft.color);

  const back = () => void editor.open(null);

  return (
    <article
      aria-labelledby={titleId}
      className="flex h-full min-h-0 flex-col"
      style={color === 'default' ? undefined : { backgroundColor: notePaperColor(color) }}
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <button
          type="button"
          onClick={back}
          className="flex min-h-11 items-center gap-0.5 rounded-full pr-3 pl-1 text-sm font-medium text-primary transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft aria-hidden className="size-5" />
          Notes
        </button>
        <span role="status" aria-live="polite" className="ml-1 truncate text-xs text-muted-foreground">
          {statusLabel(editor.status, trashed)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {editable ? (
            <button
              type="button"
              onClick={() => {
                // Done is a moment the text is meant to be kept: saved now, not when the autosave next comes round.
                if (isEditing) void editor.flush();
                setEditing(!isEditing);
              }}
              className={cn(
                'inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isEditing ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground active:bg-accent',
              )}
            >
              {isEditing ? <Check aria-hidden className="size-4" /> : <Pencil aria-hidden className="size-4" />}
              {isEditing ? 'Done' : 'Edit'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setActions(true)}
            aria-label="Note actions"
            className="grid size-10 place-items-center rounded-full text-muted-foreground transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal aria-hidden className="size-5" />
          </button>
        </div>
      </header>

      <ProblemBanner state={state} />
      {trashed ? (
        <p role="status" className="mx-4 mt-3 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          In the trash. Restore it to edit it again.
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-4 pt-4 pb-10">
          {isEditing ? (
            <>
              <label htmlFor={titleId} className="sr-only">
                Title
              </label>
              <input
                id={titleId}
                value={draft.title}
                onChange={(event) => editor.edit({ title: event.target.value })}
                onBlur={() => void editor.flush()}
                placeholder="Title"
                className="w-full bg-transparent text-2xl font-semibold tracking-tight text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none"
              />
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
                // 16px, and it grows with the text: the page scrolls, not a box inside it.
                className="mt-3 min-h-[50dvh] w-full flex-1 resize-none bg-transparent text-base leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none [field-sizing:content]"
              />
              <label
                htmlFor={tagsId}
                className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Tags
              </label>
              <input
                id={tagsId}
                value={tagField}
                onChange={(event) => {
                  setTagField(event.target.value);
                  editor.edit({ tags: parseTagField(event.target.value) });
                }}
                onBlur={() => void editor.flush()}
                placeholder="Separate tags with commas"
                className="mt-1.5 min-h-11 w-full rounded-xl border border-border/70 bg-card/70 px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </>
          ) : (
            <>
              <h1 id={titleId} className="text-2xl font-semibold tracking-tight text-foreground">
                {noteDisplayTitle({ title: normalizeNoteTitle(draft.title), body: draft.body })}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {shared ? (
                  <span className="inline-flex items-center gap-1 font-medium text-primary">
                    <Users aria-hidden className="size-3" /> Shared with the workspace
                  </span>
                ) : (
                  <span>Private</span>
                )}
                {note.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </p>
              <div className="mt-4 text-base leading-relaxed text-foreground">
                {draft.body.trim() ? (
                  <Suspense fallback={<p className="text-muted-foreground">Opening…</p>}>
                    <NoteMarkdown body={draft.body} />
                  </Suspense>
                ) : (
                  <p className="text-muted-foreground">Nothing written yet.{editable ? ' Tap Edit to start.' : ''}</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <BottomSheet open={actions} onClose={() => setActions(false)} title="Note">
        <BottomSheetRow
          icon={note.pinned ? <PinOff className="size-5" /> : <Pin className="size-5" />}
          label={note.pinned ? 'Unpin' : 'Pin to top'}
          onClick={() => {
            setActions(false);
            void state.setPinned(note.id, !note.pinned);
          }}
        />
        {note.mine && editable ? (
          <BottomSheetRow
            icon={<Users className="size-5" />}
            label={shared ? 'Make private' : 'Share with the workspace'}
            detail={shared ? 'Only you will see it' : 'Everyone in this workspace can read and edit it'}
            disabled={state.busy}
            onClick={() => {
              setActions(false);
              if (shared) setConfirm('unshare');
              else void state.setShared(true);
            }}
          />
        ) : null}
        {editable ? (
          <fieldset className="px-2.5 py-3">
            <legend className="mb-2 px-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Colour
            </legend>
            <div className="flex flex-wrap gap-2.5">
              {NOTE_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={color === option}
                  aria-label={NOTE_APPEARANCE_LABELS.color[option]}
                  onClick={() => {
                    editor.edit({ color: option });
                    void editor.flush();
                  }}
                  style={{ backgroundColor: notePaperColor(option) }}
                  className={cn(
                    'grid size-10 place-items-center rounded-full border transition-transform active:scale-95',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    color === option ? 'border-2 border-foreground' : 'border-border',
                  )}
                >
                  {color === option ? <Check aria-hidden className="size-4 text-foreground" /> : null}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}
        {canBin && !trashed && state.canWrite ? (
          <BottomSheetRow
            icon={<Trash2 className="size-5" />}
            label="Move to trash"
            tone="danger"
            onClick={() => {
              setActions(false);
              void state.trash();
            }}
          />
        ) : null}
        {canBin && trashed && state.canWrite ? (
          <>
            <BottomSheetRow
              icon={<RotateCcw className="size-5" />}
              label="Restore"
              onClick={() => {
                setActions(false);
                void state.restore();
              }}
            />
            <BottomSheetRow
              icon={<X className="size-5" />}
              label="Delete forever"
              tone="danger"
              onClick={() => {
                setActions(false);
                setConfirm('delete');
              }}
            />
          </>
        ) : null}
      </BottomSheet>

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
        danger
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

// ── small parts ───────────────────────────────────────────────────────────

function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  small = false,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  small?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
      {options.map((option) => (
        // biome-ignore lint/a11y/useSemanticElements: a row of chips is a radio group drawn as buttons, the pattern the strip of sections uses too.
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'shrink-0 rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            small ? 'min-h-8 px-3 text-xs' : 'min-h-9 px-4 text-sm',
            value === option.value
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-muted text-muted-foreground active:bg-accent',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string | null; children: ReactNode }) {
  return (
    <section aria-label={title ?? 'Notes'}>
      {title ? (
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      ) : null}
      <ul className="grid gap-2 md:grid-cols-2">{children}</ul>
    </section>
  );
}

function ErrorLine({ state }: { state: NotesState }) {
  if (!state.error) return null;
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-2 rounded-2xl bg-destructive/10 px-3 py-2.5 text-sm"
    >
      <span className="text-destructive">{state.error}</span>
      <button type="button" onClick={state.dismissError} className="shrink-0 underline underline-offset-2">
        Dismiss
      </button>
    </div>
  );
}

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

/** "3:22 PM" today, "Oct 10" before — in the workspace's zone: a note is the workspace's, not the browser's. */
function whenLabel(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return zonedDayKey(at, timeZone) === zonedDayKey(new Date(), timeZone)
    ? at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone })
    : at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone });
}

function emptyTitle(state: NotesState): string {
  if (state.search.trim()) return 'No notes match';
  switch (state.tab) {
    case 'trash':
      return 'The trash is empty';
    case 'shared':
      return 'Nothing shared yet';
    case 'mine':
    case 'all':
      return 'No notes yet';
  }
}

function emptyBody(state: NotesState): string {
  if (state.search.trim()) return 'Try another word, or clear the search.';
  if (state.tab === 'trash') return 'Notes you move to the trash wait here until you delete them.';
  if (state.tab === 'shared') return 'Notes shared with everyone in this workspace show here.';
  return state.canWrite ? 'Tap ＋ to write your first note.' : 'Notes written in this workspace will show here.';
}
