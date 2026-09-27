'use client';

import { cn } from '@kwtech/web-ui/react';
import { Pin, Search, Users } from 'lucide-react';
import { useId } from 'react';
import type { NoteLook } from '../../domain/appearance.js';
import { normalizeNoteColor } from '../../domain/appearance.js';
import type { NoteSummaryView } from '../note-client.js';
import type { NotesState } from '../use-notes.js';
import { notePaperColor } from '../view/appearance.js';
import { noteLinesStyle } from './paper.js';

/**
 * The index: search, the tag filter, and the notes — pinned first.
 *
 * Every row is exactly two rules tall (title, then preview), so on the Notebook
 * the list is written on the lines like a table of contents.
 */
export function NoteIndex({
  state,
  look,
  onOpen,
}: {
  state: NotesState;
  look: NoteLook;
  onOpen: (id: string) => void;
}) {
  const searchId = useId();
  const tagId = useId();
  const { list, ordered, editor } = state;
  const openId = editor.note?.id ?? null;
  const tags = list?.tags ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <label htmlFor={searchId} className="sr-only">
          Search notes
        </label>
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id={searchId}
            type="search"
            value={state.search}
            onChange={(event) => state.setSearch(event.target.value)}
            placeholder="Search…"
            className="w-full rounded-md border border-border bg-background/70 py-1 pr-2 pl-7 font-sans text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </div>
        {tags.length > 0 || state.tag ? (
          <>
            <label htmlFor={tagId} className="sr-only">
              Filter by tag
            </label>
            <select
              id={tagId}
              value={state.tag ?? ''}
              onChange={(event) => state.setTag(event.target.value || null)}
              className="max-w-[45%] rounded-md border border-border bg-background/70 px-2 py-1 font-sans text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <option value="">All tags</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  #{tag}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto leading-(--note-rule)" style={noteLinesStyle(look)}>
        {ordered.length === 0 ? (
          <p className="px-3 text-sm text-muted-foreground">
            {list === null ? 'Opening your notes…' : emptyMessage(state)}
          </p>
        ) : (
          <ul aria-label="Notes">
            {ordered.map((note) => (
              <li key={note.id}>
                <IndexRow note={note} open={note.id === openId} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )}
        {list?.nextCursor ? (
          <button
            type="button"
            onClick={() => void state.loadMore()}
            className="mx-3 text-sm text-primary underline underline-offset-2 hover:no-underline"
          >
            Show more notes
          </button>
        ) : null}
      </div>
    </div>
  );
}

function IndexRow({ note, open, onOpen }: { note: NoteSummaryView; open: boolean; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(note.id)}
      aria-current={open ? 'true' : undefined}
      className={cn(
        'block w-full px-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
        open ? 'bg-primary/10' : 'hover:bg-foreground/5',
      )}
    >
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full border border-border"
          style={{ backgroundColor: notePaperColor(normalizeNoteColor(note.color), 'strong') }}
        />
        <span className={cn('truncate', open && 'font-semibold')}>{note.displayTitle}</span>
        {note.pinned ? <Pin aria-label="Pinned" className="size-3.5 shrink-0 text-primary" /> : null}
        {note.visibility === 'workspace' ? (
          <Users aria-label="Shared with the workspace" className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
      </span>
      <span className="block truncate text-[0.85em] text-muted-foreground">
        {note.preview || (note.mine ? 'Nothing written yet' : `By ${note.authorName ?? 'a member'}`)}
      </span>
    </button>
  );
}

function emptyMessage(state: NotesState): string {
  if (state.search || state.tag) return 'No notes match.';
  switch (state.tab) {
    case 'trash':
      return 'The trash is empty.';
    case 'shared':
      return 'Nothing has been shared with this workspace yet.';
    case 'mine':
    case 'all':
      return state.canWrite ? 'No notes yet. Start one with New note.' : 'No notes here yet.';
  }
}
