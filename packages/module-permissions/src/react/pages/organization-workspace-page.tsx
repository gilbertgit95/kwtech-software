'use client';

import { useIconSet } from '@kwtech/web-ui/react';
import { useMemo } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import type { PermissionsClient } from '../permissions-client.js';
import { createPermissionsClient } from '../permissions-client.js';
import { organizationSectionHref, workspaceHref } from '../tenant-nav.js';
import { usePermissions } from '../use-permissions.js';
import { AdminPlaceholder } from './admin-page.js';
import { OrganizationNotices } from './organization-notices.js';
import { TenantPage } from './tenant-page.js';
import { useMyWorkspace } from './use-my-workspace.js';

/**
 * `/organizations/:organizationId/workspaces/:workspaceId` — a workspace's
 * front door: what it is, how many are in it, and the way in to each area.
 *
 * ## THE FIRST WORKSPACE-LEVEL SCREEN IN THIS CODEBASE
 *
 * That is not a decoration. `/organizations/:orgId/workspaces/:wsId` is the
 * convention `scope.ts` parses, so a request from here resolves at WORKSPACE
 * level — and `myWorkspace` declares `@RequireScope('workspace')`, which makes
 * the guard run `canAccessWorkspace` BEFORE it asks any feature question.
 *
 * §12.33 settled that workspace membership is REQUIRED and that no role widens
 * which workspaces you may enter, with `platform:support_access` the single
 * exemption. Until this screen existed, nothing resolved a workspace-level
 * request, so that rule had never once been enforced against a real caller —
 * only described, and checked in tests.
 *
 * The visible consequence, worth stating because it will look like a bug the
 * first time somebody hits it: an organization administrator who is not IN this
 * workspace is refused. That is the model working. They can still rename or
 * archive it from `/organizations/:id/workspaces`, because `workspaces:manage`
 * is the right to manage a tenant's workspaces and renaming one is not entering
 * it.
 *
 * ## Why this is Overview, and members and editing live next door
 *
 * It was ONE page holding a rename form, the member list and an archive
 * control, labelled "Overview" — which is not what an overview is, and the
 * label said something the page did not do. The editing moved to Settings
 * first, and then the member list moved to a Members page of its own, so the
 * workspace area reads exactly as the organization's does: Overview, Members,
 * Settings. Like the organization's, this page is a count plus a way in, and
 * nothing is edited here.
 *
 * Members are not settings, which is why they did not go to Settings with the
 * rest: "who is in this workspace" is a question of its own, with its own page.
 */
export function OrganizationWorkspacePage({
  organizationId,
  workspaceId,
  client,
}: {
  organizationId: string | undefined;
  workspaceId: string | undefined;
  client?: PermissionsClient;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const { view, workspace, error, notice } = useMyWorkspace(api, organizationId, workspaceId);
  const permissions = usePermissions();
  const iconSet = useIconSet();
  const iconsByName = useMemo(() => new Map((iconSet ?? []).map((option) => [option.name, option.Icon])), [iconSet]);

  /*
   * The viewer's own role IN THIS WORKSPACE, read off the member list rather
   * than from the permission context — which carries the resolved KEYS and not
   * the role that produced them.
   *
   * It says something the header's badge cannot: that one is APP level and the
   * same everywhere, while this differs per workspace, which is the whole
   * reason the level exists.
   */
  const myRole = workspace?.members.find((member) => member.userId === permissions?.subjectId)?.roles[0];
  const MyRoleIcon = myRole?.icon ? iconsByName.get(myRole.icon) : undefined;

  return (
    <TenantPage
      organizationName={view?.organizationName}
      organizationId={view?.organizationId}
      title={workspace?.name ?? 'Workspace'}
      // Always the KEY, with the description in a field of its own below — see
      // the organization overview for why it is not the subtitle.
      description={workspace ? `Key: ${workspace.key}` : undefined}
      feature={FEATURE.organizationRead}
      backTo={{ href: organizationSectionHref(organizationId ?? '', 'workspaces'), label: 'Workspaces' }}
    >
      <OrganizationNotices error={error} notice={notice} />

      {view === undefined ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : !view || !workspace ? (
        <AdminPlaceholder>
          No workspace with that id here, or you are not a member of it. Membership is required to reach a workspace and
          no role widens that — ask somebody already inside to add you.
        </AdminPlaceholder>
      ) : (
        <div className="flex flex-col gap-8">
          {workspace.archived ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              This workspace is archived. It stops resolving, so nobody can act inside it and no grant made in it
              applies. Its rows are kept, so past access stays readable.
            </p>
          ) : null}

          {/* Its own labelled block, for the reason the organization's is. */}
          <div className="rounded-lg border border-border px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Description</p>
            <p className="mt-1 text-sm">
              {workspace.description ?? <span className="text-muted-foreground">Not set</span>}
            </p>
            {workspace.description === workspace.name ? (
              <p className="mt-1 text-xs text-muted-foreground">
                This is the name, copied in as a starting value. Change it in Settings.
              </p>
            ) : null}
          </div>

          {myRole ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              You are
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-foreground">
                {MyRoleIcon ? <MyRoleIcon aria-hidden="true" className="size-3.5" /> : null}
                {myRole.label}
              </span>
              in this workspace.
            </p>
          ) : (
            /*
              A member holding no workspace role is a normal state, and saying so
              beats silence: they still act through whatever their ORGANIZATION
              role grants, which is not guessable from an empty space.
            */
            <p className="text-sm text-muted-foreground">
              You hold no role in this workspace. You can still act here through your organization role.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Members" value={workspace.members.length} />
          </div>

          {/*
            A count plus a way in, as on the organization's overview: nothing is
            edited here. Members is offered to everybody who may open the
            workspace, because its page takes the same key this one does;
            Settings only to somebody holding `workspaces:manage`, so a member
            without it is not sent to a page whose every control is hidden.
          */}
          <nav aria-label="This workspace" className="grid gap-3 sm:grid-cols-2">
            <Card
              href={`${workspaceHref(view.organizationId, workspace.id)}/members`}
              title="Members"
              description="Who is in this workspace, and what role each holds here."
            />
            <FeatureGate allOf={[FEATURE.workspacesUpdate]}>
              <Card
                href={`${workspaceHref(view.organizationId, workspace.id)}/settings`}
                title="Settings"
                description="This workspace’s name, key and description — and archiving it."
              />
            </FeatureGate>
          </nav>
        </div>
      )}
    </TenantPage>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Card({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <a
      href={href}
      className="rounded-lg border border-border px-4 py-3 transition-colors hover:border-primary/50 hover:bg-accent"
    >
      <span className="block font-medium">{title}</span>
      <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
    </a>
  );
}
