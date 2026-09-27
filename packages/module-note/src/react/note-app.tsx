'use client';

import type { AppProps } from '@kwtech/module-kit';
import { cn } from '@kwtech/web-ui/react';
import { useState } from 'react';

/**
 * ⚠ SAMPLE DATA, NOT NOTES. The placeholder screen needs something to lay out so
 * the Apps page's tabs and grid can be tried with a realistic shape. Nothing is
 * read or saved; this list goes when the notes API lands.
 */
const SAMPLE_NOTES = [
  { id: 'n1', title: 'Opening checklist', body: 'Lights, till float, signage by the door.' },
  { id: 'n2', title: 'Supplier call', body: 'Ask about the delivery window for next week.' },
  { id: 'n3', title: 'Ideas', body: 'A loyalty card, and a quieter chime for the queue.' },
] as const;

/**
 * Notes as a SUB-APP on the workspace's Apps page — a PLACEHOLDER.
 *
 * It exists so the Apps page and the module wiring can be tested end to end
 * with more than one app. The shape is the real contract all the same:
 *
 * - `@container`, and `@…:` variants rather than `sm:` / `lg:`, because a grid
 *   cell is narrow on a wide screen. The list sits above the note when narrow
 *   and beside it when there is room.
 * - Which note is open is this component's own state, never a URL: a link would
 *   leave the Apps page and close every other app running on it.
 */
export function NoteApp({ workspaceId }: AppProps) {
  const [openId, setOpenId] = useState<string>(SAMPLE_NOTES[0].id);
  const open = SAMPLE_NOTES.find((note) => note.id === openId) ?? SAMPLE_NOTES[0];

  return (
    <div className="@container flex h-full w-full flex-col gap-4 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <p className="text-xs text-muted-foreground">Coming soon — sample notes, nothing is saved.</p>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 @xl:grid-cols-[14rem_1fr]">
        <nav aria-label="Notes" className="flex flex-col gap-1">
          {SAMPLE_NOTES.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => setOpenId(note.id)}
              aria-current={note.id === openId ? 'true' : undefined}
              className={cn(
                'rounded-md px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                note.id === openId ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              {note.title}
            </button>
          ))}
        </nav>

        <section aria-labelledby="note-open-title" className="rounded-lg border border-border bg-card p-4">
          <h2 id="note-open-title" className="text-lg font-semibold">
            {open.title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{open.body}</p>
        </section>
      </div>

      <p className="text-xs text-muted-foreground">Workspace {workspaceId}</p>
    </div>
  );
}
