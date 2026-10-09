'use client';

import type { AppProps } from '@kwtech/module-kit';
import { cn, Tooltip } from '@kwtech/web-ui/react';
import { ChevronsLeft, ChevronsRight, Plus } from 'lucide-react';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import { AppearanceMenu } from './components/appearance-menu.js';
import { NoteIndex } from './components/note-index.js';
import { NotePage } from './components/note-page.js';
import { noteRootStyle, Paper } from './components/paper.js';
import type { NoteClient, NoteTab } from './note-client.js';
import { useNotes } from './use-notes.js';
import { NOTE_LOOK_SPECS } from './view/appearance.js';
import {
  adjacentNote,
  choiceAfterOpening,
  NOTE_NARROW_REM,
  type NoteIndexLayout,
  noteIndexLayout,
  noteToOpenOnLoad,
} from './view/layout.js';

const TABS: readonly { tab: NoteTab; label: string }[] = [
  { tab: 'all', label: 'All' },
  { tab: 'mine', label: 'Mine' },
  { tab: 'shared', label: 'Shared' },
  { tab: 'trash', label: 'Trash' },
];

/**
 * Notes as a SUB-APP on the workspace's Apps page.
 *
 * - Laid out by the BOX's width, never the viewport's, because a grid cell is
 *   narrow on a wide screen. A bar between the list and the note collapses and
 *   expands the list at every width (`noteIndexLayout`); in the Notebook look
 *   the two side by side are an open notebook.
 * - Which note is open is this component's own state, never a URL: a link would
 *   leave the Apps page and close every other app running on it.
 * - ⚠ Everything is drawn from the app's theme (`view/appearance.ts`); the
 *   viewer's look, font and colours only tint it.
 */
export function NoteApp({ organizationId, workspaceId, client }: AppProps & { client?: NoteClient }) {
  const state = useNotes(organizationId, workspaceId, client ? { client } : {});
  const { settings, editor } = state;
  const look = settings.look;
  const spread = NOTE_LOOK_SPECS[look].spread;
  const open = editor.note !== null;
  const pageColor = editor.draft?.color ?? 'default';

  const rootRef = useRef<HTMLDivElement>(null);
  const narrow = useIsNarrow(rootRef);
  const indexId = useId();
  // What the person chose with the bar; null is automatic (see `noteIndexLayout`).
  const [choice, setChoice] = useState<boolean | null>(null);
  const layout = noteIndexLayout({ narrow, noteOpen: open, choice });
  // The notebook's two-page spread: only while both pages are side by side.
  const joined = spread && layout === 'beside';

  /*
   * Page-turning while the list is collapsed, so reaching the next note does not
   * mean opening the list. Same order as the list: pinned first.
   */
  const hasMore = state.list?.nextCursor != null;
  const openId = editor.note?.id ?? null;
  const turn = async (direction: 'previous' | 'next') => {
    let target = adjacentNote(state.ordered, openId, direction, hasMore);
    if (target === 'load_more') {
      const first = (await state.loadMore())[0];
      target = first ? { id: first.id } : null;
    }
    if (target) openNote(target.id);
  };
  const pager =
    layout === 'hidden' && open
      ? {
          previous: adjacentNote(state.ordered, openId, 'previous', hasMore) ? () => void turn('previous') : null,
          next: adjacentNote(state.ordered, openId, 'next', hasMore) ? () => void turn('next') : null,
        }
      : undefined;

  /*
   * The first note, opened by itself when the list first arrives.
   * ⚠ ONCE, on load, and never again: a note closed afterwards (deleted
   * forever, unshared by its author) leaves the page empty on purpose, and
   * a search or a tab that changes the list must not change the open note.
   */
  const openedOnLoad = useRef(false);
  const listLoaded = state.list !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the list first arrives, not on every change to it.
  useEffect(() => {
    if (!listLoaded || openedOnLoad.current) return;
    openedOnLoad.current = true;
    const first = noteToOpenOnLoad({ ordered: state.ordered, openId, narrow });
    if (first) void editor.open(first);
  }, [listLoaded]);

  // Escape puts the slid-out list away — only while focus is inside it, so it
  // never steals Escape from the editor or a menu on the note.
  useEffect(() => {
    if (layout !== 'overlay') return;
    const onKey = (event: KeyboardEvent) => {
      const list = document.getElementById(indexId);
      if (event.key === 'Escape' && list?.contains(event.target as Node)) setChoice(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [layout, indexId]);

  const openNote = (noteId: string) => {
    setChoice((current) => choiceAfterOpening(narrow, current));
    void editor.open(noteId);
  };

  return (
    <div
      ref={rootRef}
      className="@container flex h-full w-full min-h-0 flex-col gap-2 p-3"
      style={noteRootStyle(settings.font)}
    >
      <header className="flex flex-wrap items-center gap-2 font-sans">
        <h1 className="sr-only">Notes</h1>
        <div role="tablist" aria-label="Which notes" className="flex items-end gap-0.5">
          {TABS.map(({ tab, label }) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={state.tab === tab}
              onClick={() => state.setTab(tab)}
              className={cn(
                'px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                // On the Notebook these are index tabs on the page's top edge.
                look === 'notebook' ? 'rounded-t-md border border-b-0 border-border' : 'rounded-md',
                state.tab === tab
                  ? 'bg-card font-medium text-card-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!state.live ? (
            <Tooltip text="Other people’s changes show when you reopen notes" align="end">
              {(tooltip) => (
                <span className="text-xs text-muted-foreground" {...tooltip}>
                  Not live
                </span>
              )}
            </Tooltip>
          ) : null}
          <AppearanceMenu settings={settings} onChange={(next) => void state.saveSettings(next)} />
          {state.canWrite ? (
            <button
              type="button"
              onClick={() => void state.createNote()}
              disabled={state.busy}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
            >
              <Plus aria-hidden="true" className="size-4" /> New note
            </button>
          ) : null}
        </div>
      </header>

      {!state.canWrite ? (
        <p role="status" className="rounded-md bg-muted px-3 py-1.5 font-sans text-sm text-muted-foreground">
          You can read notes here, but your role or your organization’s plan does not include writing them.
        </p>
      ) : null}

      {state.error ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 font-sans text-sm"
        >
          <span>{state.error}</span>
          <button type="button" onClick={state.dismissError} className="shrink-0 underline underline-offset-2">
            Dismiss
          </button>
        </div>
      ) : null}

      {/*
       * The list and the note. The bar between them hides and shows the list at
       * any width (`noteIndexLayout`): beside the note when wide, slid over it
       * when narrow, the whole box when narrow with no note open.
       */}
      <div className="relative flex min-h-0 flex-1">
        <div className={cn('flex min-h-0', WRAPPER[layout])}>
          {layout !== 'hidden' ? (
            <Paper
              id={indexId}
              look={look}
              color="default"
              side={joined ? 'left' : 'single'}
              className={cn(INDEX_WIDTH[layout], joined && 'rounded-r-none border-r-0')}
            >
              <NoteIndex state={state} look={look} onOpen={openNote} />
            </Paper>
          ) : null}
          <CollapseBar
            expanded={layout !== 'hidden'}
            controls={indexId}
            joined={joined}
            onToggle={() => setChoice(layout === 'hidden')}
          />
        </div>
        {layout !== 'full' ? (
          <Paper
            look={look}
            color={pageColor}
            side={joined ? 'right' : 'single'}
            className={cn('min-w-0 flex-1', joined && 'rounded-l-none')}
          >
            <NotePage state={state} look={look} pager={pager} />
          </Paper>
        ) : null}
      </div>
    </div>
  );
}

/** The list-and-bar group, per layout. */
const WRAPPER: Record<NoteIndexLayout, string> = {
  beside: 'shrink-0',
  // Over the note, on the left, above it — and wide enough to read, never the whole box.
  overlay: 'absolute inset-y-0 left-0 z-10',
  full: 'min-w-0 flex-1',
  hidden: 'shrink-0',
};

const INDEX_WIDTH: Record<NoteIndexLayout, string> = {
  beside: 'w-[clamp(14rem,30cqw,22rem)]',
  overlay: 'w-[min(20rem,80cqw)] shadow-lg shadow-foreground/15',
  full: 'min-w-0 flex-1',
  hidden: '',
};

/**
 * The thin bar that collapses and expands the notes list. A real button, with
 * the list's id in `aria-controls` and its state in `aria-expanded`; collapsed,
 * it reads "Notes" down its length so the way back is never an unlabelled
 * sliver.
 */
function CollapseBar({
  expanded,
  controls,
  joined,
  onToggle,
}: {
  expanded: boolean;
  controls: string;
  joined: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip text={expanded ? 'Hide the notes list' : 'Show the notes list'} side="right" describes={false}>
      {(tooltip) => (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={controls}
          aria-label={expanded ? 'Hide the notes list' : 'Show the notes list'}
          className={cn(
            'flex w-5 shrink-0 flex-col items-center justify-center gap-2 font-sans text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            // Between the two halves of a spread it IS the join, so it takes the paper's border.
            joined ? 'border-y border-border bg-card' : 'mx-1 rounded-md',
          )}
          {...tooltip}
        >
          {expanded ? (
            <ChevronsLeft aria-hidden="true" className="size-4" />
          ) : (
            <>
              <ChevronsRight aria-hidden="true" className="size-4" />
              <span aria-hidden="true" className="text-xs [writing-mode:vertical-rl]">
                Notes
              </span>
            </>
          )}
        </button>
      )}
    </Tooltip>
  );
}

/**
 * Whether the box is narrower than `NOTE_NARROW_REM`. Measured, not a media
 * query: it is the CELL on the Apps page that matters, and the list's layout
 * changes behaviour here (it gets out of the way once a note is picked), not
 * only its styling.
 */
function useIsNarrow(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setNarrow(element.clientWidth < NOTE_NARROW_REM * rem);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return narrow;
}
