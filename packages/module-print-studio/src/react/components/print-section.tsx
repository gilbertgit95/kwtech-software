'use client';

import { cn } from '@kwtech/web-ui/react';
import { FileText, Images, Plus, UsersRound } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
import type { StudioLayoutSpec } from '../../domain/layout.js';
import { STUDIO_PRESETS } from '../../domain/presets.js';
import type { StudioAppState } from '../studio-state.js';
import { useStudioData } from '../use-studio-data.js';
import { cellGroups } from '../view/summary.js';
import { DocumentStudio } from './document-studio.js';
import { Alert } from './layout.js';
import type { ChosenLayout } from './layouts-section.js';
import { PhotoStudio } from './photo-studio.js';
import { SheetView } from './sheet-view.js';

type Mode = 'photos' | 'document';

/**
 * The Print screen: photos in a layout, or a document as whole pages.
 *
 * Two modes because they are two different jobs (PRINT-STUDIO-PLAN decision 5):
 * a photo goes into a layout's cells, a PDF never does.
 *
 * ⚠ CHOOSING A LAYOUT HAPPENS HERE, as pictures — the person's own layouts,
 * the shared ones and the ready-made ones, each drawn to scale. The Layouts
 * tab is for MAKING and managing them; somebody who only wants to print should
 * never have to go there (the operator, 2026-10-05: "more user friendly").
 */
export function PrintSection({
  state,
  layout,
  onLayout,
  onBrowseLayouts,
}: {
  state: StudioAppState;
  /** The layout chosen to print photos with, or null before one is. */
  layout: ChosenLayout | null;
  onLayout: (layout: ChosenLayout | null) => void;
  /** Open the Layouts section, to make a new one. */
  onBrowseLayouts: () => void;
}) {
  const [mode, setMode] = useState<Mode>('photos');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <fieldset className="inline-flex self-start rounded-lg border border-border bg-background p-0.5">
        <legend className="sr-only">What to print</legend>
        {(
          [
            { key: 'photos', label: 'Photos', icon: Images },
            { key: 'document', label: 'A PDF document', icon: FileText },
          ] as const
        ).map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={mode === option.key}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              mode === option.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            )}
            onClick={() => setMode(option.key)}
          >
            <option.icon aria-hidden="true" className="size-4" />
            {option.label}
          </button>
        ))}
      </fieldset>

      {mode === 'document' ? <DocumentStudio state={state} /> : null}

      {layout ? (
        // ⚠ HIDDEN, NOT UNMOUNTED, while a document is open: it holds the chosen photos, in memory and nowhere else.
        <div className={mode === 'photos' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          {/* ⚠ Keyed by the layout: choosing another starts a fresh studio, which releases the photos of the last. */}
          <PhotoStudio
            key={`${layout.id ?? 'preset'}:${layout.name}`}
            state={state}
            layout={layout}
            onChangeLayout={() => onLayout(null)}
          />
        </div>
      ) : null}

      {mode === 'photos' && !layout ? (
        <LayoutGallery state={state} onLayout={onLayout} onBrowseLayouts={onBrowseLayouts} />
      ) : null}
    </div>
  );
}

/** Step one of printing photos: pick the sheet they go on, from pictures of the sheets. */
function LayoutGallery({
  state,
  onLayout,
  onBrowseLayouts,
}: {
  state: StudioAppState;
  onLayout: (layout: ChosenLayout) => void;
  onBrowseLayouts: () => void;
}) {
  const load = useCallback(() => state.client.layouts(state.scope), [state.client, state.scope]);
  const layouts = useStudioData(load, 'Could not load your layouts.');
  const mine = (layouts.data ?? []).filter((one) => one.mine);
  const shared = (layouts.data ?? []).filter((one) => !one.mine);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Choose a layout</h2>
        <p className="text-sm text-muted-foreground">Pick the sheet your photos will go on. You add the photos next.</p>
      </div>
      <Alert message={layouts.error} />

      {mine.length > 0 ? (
        <Shelf title="Your layouts">
          {mine.map((one) => (
            <LayoutTile
              key={one.id}
              name={one.name}
              spec={one.spec}
              note={one.visibility === 'workspace' ? 'Shared' : null}
              onPick={() => onLayout({ id: one.id, name: one.name, spec: one.spec, foreign: false })}
            />
          ))}
        </Shelf>
      ) : null}

      {shared.length > 0 ? (
        <Shelf title="Shared with the workspace">
          {shared.map((one) => (
            <LayoutTile
              key={one.id}
              name={one.name}
              spec={one.spec}
              note={`By ${one.ownerName ?? 'a member'}`}
              onPick={() => onLayout({ id: one.id, name: one.name, spec: one.spec, foreign: true })}
            />
          ))}
        </Shelf>
      ) : null}

      <Shelf title="Ready-made">
        {STUDIO_PRESETS.map((preset) => (
          <LayoutTile
            key={preset.key}
            name={preset.name}
            spec={preset.spec}
            note={null}
            onPick={() => onLayout({ id: null, name: preset.name, spec: preset.spec, foreign: false })}
          />
        ))}
        {state.can.write ? (
          <button
            type="button"
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-3 text-center text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onBrowseLayouts}
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-muted">
              <Plus aria-hidden="true" className="size-4" />
            </span>
            Make your own
          </button>
        ) : null}
      </Shelf>
    </div>
  );
}

function Shelf({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-6">{children}</div>
    </section>
  );
}

/** One layout, as a picture of its sheet with its name under it. The whole tile is the button. */
function LayoutTile({
  name,
  spec,
  note,
  onPick,
}: {
  name: string;
  spec: StudioLayoutSpec;
  note: string | null;
  onPick: () => void;
}) {
  const groups = cellGroups(spec.cells, 'in');
  return (
    <button
      type="button"
      className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-3 text-left shadow-xs transition-colors hover:border-primary hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onPick}
    >
      <span className="flex h-36 w-full items-center justify-center rounded-lg bg-muted/40 p-2">
        <SheetView spec={spec} labels={false} label={`Preview of ${name}`} className="h-full w-auto shadow-sm" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {groups.length === 0 ? 'No cells' : groups.map((group) => `${group.count} × ${group.label}`).join(', ')}
        </span>
        {note ? (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <UsersRound aria-hidden="true" className="size-3" />
            {note}
          </span>
        ) : null}
      </span>
    </button>
  );
}
