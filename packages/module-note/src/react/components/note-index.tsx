'use client';

import { DndContext, type DragEndEvent, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn, LIST_ITEM, LIST_KEYS } from '@kwtech/web-ui/react';
import { Pin, Search, Users } from 'lucide-react';
import { type KeyboardEvent, useId } from 'react';
import type { NoteLook } from '../../domain/appearance.js';
import { normalizeNoteColor } from '../../domain/appearance.js';
import type { NoteSummaryView } from '../note-client.js';
import type { NotesState } from '../use-notes.js';
import { notePaperColor, stickyTilt } from '../view/appearance.js';
import { dropResult, keyboardMove } from '../view/layout.js';
import { noteLinesStyle } from './paper.js';

/**
 * The index: search, the tag filter, and the notes — pinned first.
 *
 * In the viewer's OWN order, which they arrange by dragging (or Ctrl+Shift+↑/↓).
 * Pinned notes and the rest are two sections, each reordered within itself.
 * Nothing moves in anybody else's list. The trash is not reorderable.
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
  const hintId = useId();
  const { list, ordered, editor } = state;
  const sortable = state.tab !== 'trash';
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
          <>
            {sortable ? (
              <p id={hintId} className="sr-only">
                Drag a note to change the order of your list, or press Control, Shift and an arrow key. Only your list
                changes.
              </p>
            ) : null}
            {list && list.pinned.length > 0 ? (
              <NoteSection
                label="Pinned notes"
                notes={list.pinned}
                section="pinned"
                look={look}
                openId={openId}
                onOpen={onOpen}
                state={state}
                hintId={sortable ? hintId : null}
              />
            ) : null}
            <NoteSection
              label="Notes"
              notes={list?.notes ?? []}
              section="notes"
              look={look}
              openId={openId}
              onOpen={onOpen}
              state={state}
              hintId={sortable ? hintId : null}
            />
          </>
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

/**
 * One section of the list — pinned, or the rest — sortable within itself.
 *
 * A drag starts only after the pointer MOVES, and a touch only after a short
 * hold, as on the Apps page's tabs: otherwise every click on a note would be a
 * zero-length drag and never open it, and a finger scrolling the list would
 * pick notes up.
 */
function NoteSection({
  label,
  notes,
  section,
  look,
  openId,
  onOpen,
  state,
  hintId,
}: {
  label: string;
  notes: readonly NoteSummaryView[];
  section: 'pinned' | 'notes';
  look: NoteLook;
  openId: string | null;
  onOpen: (id: string) => void;
  state: NotesState;
  /** The how-to-reorder hint's id; null where the list cannot be reordered (the trash). */
  hintId: string | null;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );
  const ids = notes.map((note) => note.id);
  const sticky = look === 'sticky';

  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over) return;
    const moved = dropResult(ids, String(event.active.id), String(event.over.id));
    if (moved) void state.moveNote(section, String(event.active.id), moved.ids, moved.afterId);
  };

  const onKeyDown = (event: KeyboardEvent, noteId: string) => {
    if (!(event.ctrlKey && event.shiftKey) || hintId === null) return;
    const back = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    if (!back && !forward) return;
    event.preventDefault();
    const moved = keyboardMove(ids, noteId, back ? -1 : 1);
    if (moved) void state.moveNote(section, noteId, moved.ids, moved.afterId);
  };

  return (
    <DndContext id={`notes-${section}`} sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={sticky ? rectSortingStrategy : verticalListSortingStrategy}>
        <ul
          aria-label={label}
          className={sticky ? 'grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3 p-3' : undefined}
          // ↑ ↓ between notes, Enter opens the one in focus. Plain arrows only: Ctrl+Shift+arrows still reorder (below).
          {...LIST_KEYS}
        >
          {notes.map((note) => (
            <SortableNote
              key={note.id}
              note={note}
              open={note.id === openId}
              sticky={sticky}
              disabled={hintId === null}
              hintId={hintId}
              onOpen={onOpen}
              onKeyDown={(event) => onKeyDown(event, note.id)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableNote({
  note,
  open,
  sticky,
  disabled,
  hintId,
  onOpen,
  onKeyDown,
}: {
  note: NoteSummaryView;
  open: boolean;
  sticky: boolean;
  disabled: boolean;
  hintId: string | null;
  onOpen: (id: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
    disabled,
  });
  const drag = {
    ref: setNodeRef,
    translate: CSS.Translate.toString(transform),
    transition,
    isDragging,
    props: {
      ...attributes,
      ...listeners,
      /*
       * After the spreads, dnd-kit's own attributes are undone: its role and
       * "sortable" description, its keyboard instructions (this list moves with
       * Ctrl+Shift+arrows, not its Space-to-lift), and `aria-disabled`, which it
       * sets wherever sorting is off — a note in the trash still opens, and must
       * not be read out as disabled.
       */
      role: undefined,
      'aria-roledescription': undefined,
      'aria-disabled': undefined,
      'aria-describedby': hintId ?? undefined,
      onKeyDown,
      // The element that is dragged is also the list's choice: the row or card button.
      ...LIST_ITEM,
    },
  };
  return (
    <li>
      {sticky ? (
        <StickyCard note={note} open={open} onOpen={onOpen} drag={drag} />
      ) : (
        <IndexRow note={note} open={open} onOpen={onOpen} drag={drag} />
      )}
    </li>
  );
}

/** What a sortable row hands the element that is dragged. */
interface DragBinding {
  ref: (element: HTMLElement | null) => void;
  translate: string | undefined;
  transition: string | undefined;
  isDragging: boolean;
  props: Record<string, unknown>;
}

function IndexRow({
  note,
  open,
  onOpen,
  drag,
}: {
  note: NoteSummaryView;
  open: boolean;
  onOpen: (id: string) => void;
  drag: DragBinding;
}) {
  return (
    <button
      ref={drag.ref}
      type="button"
      {...drag.props}
      onClick={() => onOpen(note.id)}
      aria-current={open ? 'true' : undefined}
      style={{ transform: drag.translate, transition: drag.transition }}
      className={cn(
        'relative block w-full px-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
        open ? 'bg-primary/10' : 'hover:bg-foreground/5',
        drag.isDragging && 'z-10 bg-(--note-paper) opacity-90',
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

/**
 * The Sticky notes look's index: a board of squares, each in its note's colour
 * at full strength and leaning a little (`stickyTilt`) — straightened while
 * open or focused, so the one you are on reads square.
 */
function StickyCard({
  note,
  open,
  onOpen,
  drag,
}: {
  note: NoteSummaryView;
  open: boolean;
  onOpen: (id: string) => void;
  drag: DragBinding;
}) {
  // The lean, after the drag's move — and none while dragged or open, so both read square.
  const tilt = open || drag.isDragging ? '' : ` rotate(${stickyTilt(note.id)}deg)`;
  return (
    <button
      ref={drag.ref}
      type="button"
      {...drag.props}
      onClick={() => onOpen(note.id)}
      aria-current={open ? 'true' : undefined}
      className={cn(
        'flex aspect-square w-full flex-col overflow-hidden p-2 text-left leading-snug shadow-md shadow-foreground/15 transition-transform focus-visible:rotate-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
        open && 'ring-2 ring-primary',
        drag.isDragging && 'relative z-10 opacity-90',
      )}
      style={{
        backgroundColor: notePaperColor(normalizeNoteColor(note.color), 'strong'),
        transform: `${drag.translate ?? ''}${tilt}`.trim() || undefined,
        transition: drag.transition,
      }}
    >
      <span className="flex items-center gap-1 font-semibold">
        <span className="line-clamp-2">{note.displayTitle}</span>
        {note.pinned ? <Pin aria-label="Pinned" className="size-3.5 shrink-0 text-primary" /> : null}
        {note.visibility === 'workspace' ? (
          <Users aria-label="Shared with the workspace" className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
      </span>
      <span className="mt-1 line-clamp-4 text-[0.85em] text-muted-foreground">{note.preview}</span>
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
