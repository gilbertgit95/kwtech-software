'use client';

import type { AppProps } from '@kwtech/module-kit';
import { cn } from '@kwtech/web-ui/react';
import { Plus } from 'lucide-react';
import { AppearanceMenu } from './components/appearance-menu.js';
import { NoteIndex } from './components/note-index.js';
import { NotePage } from './components/note-page.js';
import { noteRootStyle, Paper } from './components/paper.js';
import type { NoteClient, NoteTab } from './note-client.js';
import { useNotes } from './use-notes.js';
import { NOTE_LOOK_SPECS } from './view/appearance.js';

const TABS: readonly { tab: NoteTab; label: string }[] = [
  { tab: 'all', label: 'All' },
  { tab: 'mine', label: 'Mine' },
  { tab: 'shared', label: 'Shared' },
  { tab: 'trash', label: 'Trash' },
];

/**
 * Notes as a SUB-APP on the workspace's Apps page.
 *
 * - `@container`, and `@…:` variants rather than `sm:` / `lg:`, because a grid
 *   cell is narrow on a wide screen. Wide, the index and the open note sit side
 *   by side — in the Notebook look as an open notebook, two pages and a spine.
 *   Narrow, one page at a time: the index, or the note with a way back.
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

  const openNote = (noteId: string) => void editor.open(noteId);

  return (
    <div className="@container flex h-full w-full min-h-0 flex-col gap-2 p-3" style={noteRootStyle(settings.font)}>
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
            <span className="text-xs text-muted-foreground" title="Other people’s changes show when you reopen notes">
              Not live
            </span>
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

      {/* Wide: index and page side by side. Narrow: one at a time. */}
      <div
        className={cn(
          'grid min-h-0 flex-1 grid-cols-1 @2xl:grid-cols-[minmax(14rem,2fr)_5fr]',
          spread ? 'gap-0' : 'gap-3',
        )}
      >
        <Paper
          look={look}
          color="default"
          side={spread ? 'left' : 'single'}
          className={cn(open ? 'hidden @2xl:block' : 'block', spread && '@2xl:rounded-r-none @2xl:border-r-0')}
        >
          <NoteIndex state={state} look={look} onOpen={openNote} />
        </Paper>
        <Paper
          look={look}
          color={pageColor}
          side={spread ? 'right' : 'single'}
          className={cn(open ? 'block' : 'hidden @2xl:block', spread && '@2xl:rounded-l-none')}
        >
          <NotePage state={state} look={look} onBack={open ? () => void editor.open(null) : undefined} />
        </Paper>
      </div>
    </div>
  );
}
