'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { createPermissionsClient, type PermissionsClient } from '../permissions-client.js';
import { organizationSectionHref, workspaceHref } from '../tenant-nav.js';
import { AdminPlaceholder } from './admin-page.js';
import { TenantPage } from './tenant-page.js';
import { useMyOrganization } from './use-my-organization.js';

/**
 * `/organizations/:organizationId/workspaces/new` — create a workspace.
 *
 * ## Why a screen, when the workspaces grid already has an inline form
 *
 * The two are for different people arriving from different places, and neither
 * one replaces the other:
 *
 *   - the inline row on `/organizations/:id/workspaces` is for somebody already
 *     ADMINISTERING the list — they are looking at the other workspaces, they
 *     want a fourth, and a full page turn for two fields would be in the way;
 *   - this page is for somebody in the SELECTOR, who is not on that screen and
 *     may not even know it exists. It is what the switcher's "New workspace"
 *     opens, exactly as the organization switcher's "New organization" opens
 *     `/organizations/new`.
 *
 * They share the one write and no markup, which is the right split: `createWorkspace`
 * is the contract, and duplicating a two-input row to avoid duplicating a
 * two-input row would be the more expensive mistake. The description field is
 * the difference — it does not fit on an inline row and does fit here.
 *
 * ## Organization level, and it has to be
 *
 * The path ends in a literal that sits where a workspace id goes, so the level
 * this resolves at is decided by the ROUTER matching the literal rather than by
 * `parseScope` reading the string — see `workspaceNewHref`. That is not a
 * detail: `workspaces:create` is an ORGANIZATION-level key (which workspaces a
 * tenant has is the tenant's decision, not a workspace's about itself), and a
 * page resolving at workspace level would be gated on a key no context there
 * can carry, then refused for a reason that reads like a permissions bug.
 *
 * ## Creating one puts you in it
 *
 * Workspace membership is required to enter a workspace and no organization
 * role widens it (§12.33), so `createWorkspace` adds its creator as a member in
 * the same transaction — otherwise this page's own success would redirect to a
 * workspace it had just locked the author out of. Platform staff join nothing:
 * they hold no membership to hang it off and enter by `platform:support_access`
 * instead, so for them the redirect lands on a workspace they can read and are
 * not in, which is the truth about their standing there.
 */
export function WorkspaceNewPage({
  organizationId,
  client,
}: {
  organizationId: string | undefined;
  client?: PermissionsClient;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  /*
   * Read only for the NAME above the title and the way back. The form itself
   * needs nothing but the id — but a create screen that cannot say which
   * company it is creating inside is the one screen in this area where that
   * question is most worth answering, because the reader arrived from a
   * selector rather than from the tenant's own pages.
   */
  const { detail, error: loadError } = useMyOrganization(api, organizationId);

  const keyId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const listHref = organizationSectionHref(organizationId ?? '', 'workspaces');

  const save = useCallback(async () => {
    const trimmedKey = key.trim();
    const trimmedName = name.trim();
    if (!organizationId) {
      setError('No organization in the URL — a workspace has to be created inside one.');
      return;
    }
    if (!trimmedKey || !trimmedName) {
      setError('A key and a name are both required.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      /*
       * Blank description sent as null rather than '', so the server applies
       * its own rule — the NAME — in one place. An empty string would store a
       * value somebody chose, which is not what leaving a field alone means.
       */
      const result = await api.createWorkspace(organizationId, trimmedKey, trimmedName, description.trim() || null);
      /*
       * Straight INTO the new workspace, not back to the list. The person who
       * came here from the selector was trying to get somewhere, and the
       * creator is a member of it as of the same transaction — so the one place
       * the redirect cannot embarrass itself is the workspace itself.
       *
       * `window.location.assign` rather than a router push, matching every
       * other write in this area: the shell resolves the selectors on the
       * SERVER from a cookie and the URL, so a client-side navigation would
       * leave the workspace selector naming the old selection until something
       * else forced a server render.
       */
      window.location.assign(result.id ? workspaceHref(organizationId, result.id) : listHref);
    } catch (cause) {
      /*
       * The cap and the duplicate key both land here, and both are the server's
       * to phrase — `workspaces:create` is bounded by the PLAN's workspace cap,
       * which this page cannot know and must not guess at.
       */
      setError(cause instanceof Error ? cause.message : 'Could not create the workspace.');
    } finally {
      setSaving(false);
    }
  }, [api, organizationId, key, name, description, listHref]);

  return (
    <TenantPage
      organizationName={detail?.name}
      organizationId={detail?.id}
      title="New workspace"
      description="A place inside this organization: its own members, its own roles."
      feature={FEATURE.workspacesCreate}
      backTo={{ href: listHref, label: 'Workspaces' }}
    >
      {detail === null ? (
        <AdminPlaceholder>
          {loadError ?? 'No organization with that id, or you are not a member of it.'}
        </AdminPlaceholder>
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <label htmlFor={keyId} className="mb-1 block text-sm font-medium">
              Key
            </label>
            <input
              id={keyId}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              A short, stable handle — <code>design</code>. Unique within this organization only: two tenants may both
              have a <code>design</code>, and they are different places.
            </p>
          </div>

          <div>
            <label htmlFor={nameId} className="mb-1 block text-sm font-medium">
              Name
            </label>
            <input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">What people read. Change it whenever you like.</p>
          </div>

          <div>
            <label htmlFor={descriptionId} className="mb-1 block text-sm font-medium">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id={descriptionId}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {/*
                Said to default to the name rather than pre-filled with it. A
                field that arrives already full invites people to accept it
                without reading; an empty one that explains its own default
                does not. This is the field the inline form on the workspaces
                grid has no room for, and the reason that one is not simply
                this one.
              */}
              What this workspace is for. Left empty, it starts as the name — you can change it in the workspace’s
              Settings later.
            </p>
          </div>

          <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            {/*
              Stated because it is the model's least guessable rule and this is
              the moment it bites: membership, not a role, is what lets somebody
              REACH a workspace, so a tenant administrator who creates one and
              is not put in it would be refused entry to their own.
            */}
            You are added to it as a member. Nobody else in the organization can reach it until they are added too — no
            organization role opens a workspace on its own.
          </p>

          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {saving ? 'Creating…' : 'Create workspace'}
            </button>
            <a href={listHref} className="text-sm text-muted-foreground hover:text-foreground">
              Cancel
            </a>
          </div>
        </div>
      )}
    </TenantPage>
  );
}
