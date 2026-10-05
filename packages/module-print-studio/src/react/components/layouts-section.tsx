'use client';

import {
  ConfirmDialog,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kwtech/web-ui/react';
import { Copy, LayoutTemplate, Lock, MoreHorizontal, Pencil, Plus, Printer, Trash2, UsersRound } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
import type { StudioLayoutSpec } from '../../domain/layout.js';
import { defaultLayoutSpec, STUDIO_PRESETS } from '../../domain/presets.js';
import type { StudioLayoutView } from '../studio-client.js';
import type { StudioAppState } from '../studio-state.js';
import { useStudioAction, useStudioData } from '../use-studio-data.js';
import { layoutSummary } from '../view/summary.js';
import { buttonClass } from './controls.js';
import { Alert, Empty, EmptyState } from './layout.js';
import { type EditorTarget, LayoutEditor } from './layout-editor.js';
import { SheetView } from './sheet-view.js';

/** A layout chosen to print with: a saved one, a preset, or one being tried before saving. */
export interface ChosenLayout {
  /** The saved layout's id, or null for a preset. Recorded in the print history. */
  id: string | null;
  name: string;
  spec: StudioLayoutSpec;
  /** Somebody else's shared layout: its margins were set for THEIR printer. */
  foreign: boolean;
}

/** A new layout starts on the default paper and margins (`defaultLayoutSpec`), with no cells. */
function blankTarget(): EditorTarget {
  return { id: null, version: 0, name: '', visibility: 'private', spec: defaultLayoutSpec() };
}

/**
 * The layouts a person can use: their own, the ones shared with the workspace,
 * and the presets that come with the studio.
 *
 * - Only the owner edits a shared layout; anybody else duplicates it
 *   (PRINT-STUDIO-PLAN decision 15). A holder of `studio:manage_all` may edit
 *   and delete other people's shared ones.
 * - Unsharing or deleting a shared layout asks first: others may be using it.
 * - Controls are hidden without `studio:write`. That only hides them — the API
 *   authorises again.
 */
export function LayoutsSection({ state, onUse }: { state: StudioAppState; onUse: (layout: ChosenLayout) => void }) {
  const load = useCallback(() => state.client.layouts(state.scope), [state.client, state.scope]);
  const layouts = useStudioData(load, 'Could not load the layouts.');
  const act = useStudioAction('Could not change the layout.');
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [confirming, setConfirming] = useState<{ kind: 'delete' | 'unshare'; layout: StudioLayoutView } | null>(null);

  const mine = (layouts.data ?? []).filter((layout) => layout.mine);
  const shared = (layouts.data ?? []).filter((layout) => !layout.mine);

  async function run(action: () => Promise<unknown>) {
    if (await act.run(action)) await layouts.reload();
  }

  if (editing) {
    return (
      <LayoutEditor
        state={state}
        target={editing}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void layouts.reload();
        }}
      />
    );
  }

  const edit = (layout: StudioLayoutView) =>
    setEditing({
      id: layout.id,
      version: layout.version,
      name: layout.name,
      visibility: layout.visibility === 'workspace' ? 'workspace' : 'private',
      spec: layout.spec,
    });
  const use = (layout: StudioLayoutView) =>
    onUse({ id: layout.id, name: layout.name, spec: layout.spec, foreign: !layout.mine });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <Alert message={layouts.error ?? act.error} onDismiss={act.error ? act.dismissError : undefined} />

      <Group
        title="My layouts"
        action={
          state.can.write ? (
            <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setEditing(blankTarget())}>
              <Plus aria-hidden="true" className="size-3.5" />
              New layout
            </button>
          ) : null
        }
      >
        {layouts.loading && !layouts.data ? <Empty>Loading…</Empty> : null}
        {layouts.data && mine.length === 0 ? (
          <EmptyState icon={LayoutTemplate} title="No layouts of your own yet">
            {state.can.write
              ? 'Make one from scratch, or copy a preset below and change it.'
              : 'You can use the shared layouts and the presets below.'}
          </EmptyState>
        ) : null}
        <Cards>
          {mine.map((layout) => (
            <LayoutCard
              key={layout.id}
              name={layout.name}
              spec={layout.spec}
              badge={layout.visibility === 'workspace' ? 'Shared' : 'Private'}
              shared={layout.visibility === 'workspace'}
              onUse={() => use(layout)}
            >
              {state.can.write ? (
                <>
                  <CardButton icon={Pencil} label="Edit" disabled={act.busy} onClick={() => edit(layout)} />
                  <CardMenu name={layout.name}>
                    <DropdownMenuItem
                      onSelect={() => void run(() => state.client.duplicateLayout(state.scope, layout.id))}
                    >
                      <Copy aria-hidden="true" />
                      Duplicate
                    </DropdownMenuItem>
                    {layout.visibility === 'workspace' ? (
                      <DropdownMenuItem onSelect={() => setConfirming({ kind: 'unshare', layout })}>
                        <Lock aria-hidden="true" />
                        Make private
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onSelect={() => void run(() => state.client.setVisibility(state.scope, layout.id, 'workspace'))}
                      >
                        <UsersRound aria-hidden="true" />
                        Share with the workspace
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => setConfirming({ kind: 'delete', layout })}
                    >
                      <Trash2 aria-hidden="true" />
                      Delete
                    </DropdownMenuItem>
                  </CardMenu>
                </>
              ) : null}
            </LayoutCard>
          ))}
        </Cards>
      </Group>

      {shared.length > 0 ? (
        <Group title="Shared with the workspace">
          <Cards>
            {shared.map((layout) => (
              <LayoutCard
                key={layout.id}
                name={layout.name}
                spec={layout.spec}
                badge={`By ${layout.ownerName ?? 'a member'}`}
                shared
                onUse={() => use(layout)}
              >
                {state.can.write ? (
                  <CardButton
                    icon={Copy}
                    label="Copy to mine"
                    disabled={act.busy}
                    onClick={() => void run(() => state.client.duplicateLayout(state.scope, layout.id))}
                  />
                ) : null}
                {state.can.write && state.can.manageAll ? (
                  <CardMenu name={layout.name}>
                    <DropdownMenuItem onSelect={() => edit(layout)}>
                      <Pencil aria-hidden="true" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => setConfirming({ kind: 'delete', layout })}
                    >
                      <Trash2 aria-hidden="true" />
                      Delete
                    </DropdownMenuItem>
                  </CardMenu>
                ) : null}
              </LayoutCard>
            ))}
          </Cards>
        </Group>
      ) : null}

      <Group title="Ready-made">
        <Cards>
          {STUDIO_PRESETS.map((preset) => (
            <LayoutCard
              key={preset.key}
              name={preset.name}
              spec={preset.spec}
              badge="Preset"
              onUse={() => onUse({ id: null, name: preset.name, spec: preset.spec, foreign: false })}
            >
              {state.can.write ? (
                <CardButton
                  icon={Copy}
                  label="Copy and edit"
                  disabled={act.busy}
                  onClick={() =>
                    setEditing({ id: null, version: 0, name: preset.name, visibility: 'private', spec: preset.spec })
                  }
                />
              ) : null}
            </LayoutCard>
          ))}
        </Cards>
      </Group>

      <ConfirmDialog
        open={confirming !== null}
        danger={confirming?.kind === 'delete'}
        pending={act.busy}
        title={confirming?.kind === 'delete' ? 'Delete this layout?' : 'Make this layout private?'}
        confirmLabel={confirming?.kind === 'delete' ? 'Delete layout' : 'Make private'}
        description={confirmText(confirming)}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const pending = confirming;
          if (!pending) return;
          void run(() =>
            pending.kind === 'delete'
              ? state.client.deleteLayout(state.scope, pending.layout.id)
              : state.client.setVisibility(state.scope, pending.layout.id, 'private'),
          ).then(() => setConfirming(null));
        }}
      />
    </div>
  );
}

/** What is lost, said before it is. A shared layout may be in somebody else's hands right now. */
function confirmText(confirming: { kind: 'delete' | 'unshare'; layout: StudioLayoutView } | null): string {
  if (!confirming) return '';
  const { kind, layout } = confirming;
  const others = layout.visibility === 'workspace' ? ' Other people in this workspace may be using it.' : '';
  if (kind === 'unshare') return `“${layout.name}” will disappear for everybody else.${others}`;
  return `“${layout.name}” will be deleted for good.${others}`;
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Cards({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-6">{children}</div>;
}

/**
 * One layout: a picture of its sheet, what it is called, and what can be done
 * with it — "Use" first, the rarer acts behind a menu, so a card is never three
 * rows of buttons.
 */
function LayoutCard({
  name,
  spec,
  badge,
  shared = false,
  onUse,
  children,
}: {
  name: string;
  spec: StudioLayoutSpec;
  badge: string;
  shared?: boolean;
  onUse: () => void;
  children?: ReactNode;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-xs">
      <button
        type="button"
        aria-label={`Use ${name}`}
        className="flex h-36 w-full items-center justify-center rounded-lg bg-muted/40 p-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onUse}
      >
        <SheetView spec={spec} labels={false} label={`Preview of ${name}`} className="h-full w-auto shadow-sm" />
      </button>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold">{name}</h3>
        <p className="truncate text-xs text-muted-foreground">{layoutSummary(spec, 'in')}</p>
        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {shared ? <UsersRound aria-hidden="true" className="size-3" /> : null}
          {badge}
        </span>
      </div>
      <div className="mt-auto flex items-center gap-1">
        <button type="button" className={buttonClass('primary', 'sm')} onClick={onUse}>
          <Printer aria-hidden="true" className="size-3.5" />
          Use
        </button>
        {children}
      </div>
    </article>
  );
}

/** The rarer things to do with a layout, behind one button. */
function CardMenu({ name, children }: { name: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`More for ${name}`}
        className={cn(buttonClass('ghost', 'sm'), 'ml-auto size-8 px-0')}
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CardButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger = false,
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(buttonClass('ghost', 'sm'), danger ? 'text-destructive' : null)}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </button>
  );
}
