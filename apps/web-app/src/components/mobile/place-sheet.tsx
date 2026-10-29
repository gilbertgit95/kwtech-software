'use client';

import { scopePath } from '@kwtech/module-permissions';
import { cn } from '@kwtech/web-ui/react';
import { ChevronLeft, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MobileSheet } from '@/components/mobile/mobile-sheet';
import type { MobilePlace } from '@/components/mobile/mobile-top-bar';
import { fetchMobileWorkspaces } from '@/components/mobile/place-client';
import { PlaceRow, PlaceSection } from '@/components/mobile/place-sections';

type View = { kind: 'organizations' } | { kind: 'workspaces'; organizationId: string };

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; workspaces: readonly MobilePlace[] }
  | { state: 'failed'; message: string };

/**
 * The switcher, ONE LEVEL PER VIEW (issue #22; the operator, 2026-10-29:
 * organizations and workspaces on one screen were what made it confusing).
 *
 *   Workspaces   where it opens: the current organization's, the switch a
 *                seller actually makes. "‹ Organizations" at the top.
 *   Organizations  every one the viewer is in, the current one marked. Tapping
 *                one SLIDES to its workspaces — it does not navigate, because
 *                an organization is not where anybody works.
 *
 * The current organization's workspaces arrive with the page; another's are
 * loaded when it is tapped, and kept for as long as the sheet is open.
 *
 * Both views stay rendered side by side and the strip slides between them,
 * so the motion shows the direction: further in to workspaces, back out to
 * organizations. The view off screen is `inert`, so neither Tab nor a screen
 * reader reaches into it.
 */
export function PlaceSheet({
  open,
  onClose,
  organizations,
  workspaces,
  activeOrganizationId,
  activeWorkspaceId,
}: {
  open: boolean;
  onClose: () => void;
  organizations: readonly MobilePlace[];
  /** The ACTIVE organization's workspaces that the viewer may enter. */
  workspaces: readonly MobilePlace[];
  activeOrganizationId: string | null;
  activeWorkspaceId: string | null;
}) {
  const startView: View = activeOrganizationId
    ? { kind: 'workspaces', organizationId: activeOrganizationId }
    : { kind: 'organizations' };
  const [view, setView] = useState<View>(startView);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});

  // Every opening starts where the person is, not where they left the sheet last time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on OPEN only; `startView` is rebuilt each render.
  useEffect(() => {
    if (open) setView(startView);
  }, [open]);

  async function openOrganization(organizationId: string) {
    setView({ kind: 'workspaces', organizationId });
    if (organizationId === activeOrganizationId || loaded[organizationId]?.state === 'ready') return;
    setLoaded((current) => ({ ...current, [organizationId]: { state: 'loading' } }));
    try {
      const list = await fetchMobileWorkspaces(organizationId);
      setLoaded((current) => ({ ...current, [organizationId]: { state: 'ready', workspaces: list } }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not load the workspaces.';
      setLoaded((current) => ({ ...current, [organizationId]: { state: 'failed', message } }));
    }
  }

  /** The current organization's list came with the page; another's is whatever its load has reached. */
  function workspacesOf(organizationId: string | null): Loaded {
    if (!organizationId) return { state: 'ready', workspaces: [] };
    if (organizationId === activeOrganizationId) return { state: 'ready', workspaces };
    return loaded[organizationId] ?? { state: 'loading' };
  }

  const shownOrganizationId = view.kind === 'workspaces' ? view.organizationId : null;
  const shownOrganization = organizations.find((one) => one.id === shownOrganizationId) ?? null;
  const onWorkspaces = view.kind === 'workspaces';

  return (
    <MobileSheet open={open} onClose={onClose} title={onWorkspaces ? 'Choose a workspace' : 'Choose an organization'}>
      <div className="overflow-hidden">
        <div
          className={cn(
            'flex w-[200%] transition-transform duration-300 ease-out motion-reduce:transition-none',
            onWorkspaces ? '-translate-x-1/2' : 'translate-x-0',
          )}
        >
          {/* ── Organizations ─────────────────────────────────────────── */}
          <div className="w-1/2 p-2" inert={onWorkspaces}>
            <PlaceSection level="organization" title="Organizations" caption="Choose one to see its workspaces">
              {organizations.map((organization) => (
                <PlaceRow
                  key={organization.id}
                  level="organization"
                  onClick={() => void openOrganization(organization.id)}
                  name={organization.name}
                  detail={organization.detail ?? null}
                  current={organization.id === activeOrganizationId}
                />
              ))}
            </PlaceSection>
          </div>

          {/* ── Workspaces of one organization ────────────────────────── */}
          <div className="w-1/2 space-y-3 p-2" inert={!onWorkspaces}>
            {organizations.length > 1 || !activeOrganizationId ? (
              <button
                type="button"
                onClick={() => setView({ kind: 'organizations' })}
                className="flex min-h-11 items-center gap-1 rounded-full px-2 pr-3 text-sm font-medium text-primary transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft aria-hidden className="size-4" />
                Organizations
              </button>
            ) : null}
            <PlaceSection
              level="workspace"
              title="Workspaces"
              caption={shownOrganization ? `In ${shownOrganization.name}` : 'In this organization'}
            >
              <WorkspaceRows
                loaded={workspacesOf(shownOrganizationId)}
                organizationId={shownOrganizationId}
                activeWorkspaceId={activeWorkspaceId}
                onRetry={() => {
                  if (shownOrganizationId) void openOrganization(shownOrganizationId);
                }}
              />
            </PlaceSection>
          </div>
        </div>
      </div>
    </MobileSheet>
  );
}

function WorkspaceRows({
  loaded,
  organizationId,
  activeWorkspaceId,
  onRetry,
}: {
  loaded: Loaded;
  organizationId: string | null;
  activeWorkspaceId: string | null;
  onRetry: () => void;
}) {
  switch (loaded.state) {
    case 'loading':
      return (
        <li className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground" role="status">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          Loading workspaces…
        </li>
      );
    case 'failed':
      return (
        <li className="space-y-2 px-4 py-4 text-sm">
          <p role="alert" className="text-destructive">
            {loaded.message}
          </p>
          <button type="button" onClick={onRetry} className="font-medium text-primary">
            Try again
          </button>
        </li>
      );
    case 'ready':
      if (!organizationId || loaded.workspaces.length === 0) {
        return <li className="px-4 py-5 text-sm text-muted-foreground">You are not in any workspace here yet.</li>;
      }
      return loaded.workspaces.map((workspace) => (
        <PlaceRow
          key={workspace.id}
          level="workspace"
          href={scopePath({ organizationId, workspaceId: workspace.id })}
          name={workspace.name}
          detail={workspace.detail ?? null}
          current={workspace.id === activeWorkspaceId}
        />
      ));
  }
}
