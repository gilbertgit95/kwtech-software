'use client';

import { ConfirmDialog } from '@kwtech/web-ui/react';
import { useEffect, useId, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import type { PermissionsClient } from '../permissions-client.js';
import { createPermissionsClient } from '../permissions-client.js';
import { ORGANIZATIONS_HREF, organizationHref } from '../tenant-nav.js';
import { usePermissions } from '../use-permissions.js';
import { AdminPlaceholder } from './admin-page.js';
import { OrganizationNotices } from './organization-notices.js';
import { TenantPage } from './tenant-page.js';
import { useMyOrganization } from './use-my-organization.js';

/**
 * `/organizations/:organizationId/settings` — the organization's own data, and
 * the way out of it.
 *
 * ## Two things, two different rights, on one page
 *
 * Renaming takes `organization:manage`. Leaving takes nothing beyond being able
 * to see the organization — walking out is the other end of the membership that
 * put you there, and a key for it would be one an administrator could withhold
 * to keep somebody in.
 *
 * So this page is gated on `organization:read` and the rename form is gated
 * inside it. An ordinary member opens Settings, sees what the organization is
 * called, and finds the way out; an owner sees the form as well.
 *
 * ## `organization:manage`, not `organizations:manage`
 *
 * One letter, and the whole difference between a customer and the platform.
 * The plural is APP level — "rename ANY tenant", which support holds — and
 * cannot be carried by an organization-level role at all: a role may only
 * collect features at its own level, so the draft validator refuses it. That
 * check is what makes the near-collision safe rather than merely documented.
 */
export function OrganizationSettingsPage({
  organizationId,
  client,
}: {
  organizationId: string | undefined;
  client?: PermissionsClient;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const { detail, error, notice, busy, run } = useMyOrganization(api, organizationId);
  const permissions = usePermissions();
  const keyId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [leaving, setLeaving] = useState(false);

  /*
   * Re-seeded whenever the organization changes underneath — after a save, or
   * on first load. Without this the fields keep whatever was typed against the
   * previous state, and a save would write it back.
   */
  useEffect(() => {
    setKey(detail?.key ?? '');
    setName(detail?.name ?? '');
    setDescription(detail?.description ?? '');
  }, [detail?.key, detail?.name, detail?.description]);

  const dirty = detail
    ? key.trim() !== detail.key || name.trim() !== detail.name || description.trim() !== (detail.description ?? '')
    : false;

  /**
   * Whether leaving would empty the organization.
   *
   * Checked HERE only to word the button honestly — the write path refuses it
   * regardless, and that refusal is the one that counts. A screen check alone
   * would be bypassed by anything calling the API; a write check alone would
   * let somebody click Leave, confirm, and be told no.
   */
  const activeMembers = detail?.members.filter((member) => member.status === 'active').length ?? 0;
  const isMember = Boolean(detail?.members.some((member) => member.userId === permissions?.subjectId));
  const wouldEmpty = isMember && activeMembers <= 1;

  return (
    <TenantPage
      organizationName={detail?.name}
      organizationId={detail?.id}
      title="Settings"
      feature={FEATURE.organizationRead}
      backTo={{ href: organizationHref(organizationId ?? ''), label: detail?.name ?? 'Organization' }}
    >
      <OrganizationNotices error={error} notice={notice} />

      {detail === undefined ? (
        <div className="h-48 animate-pulse rounded-md bg-muted" />
      ) : !detail ? (
        <AdminPlaceholder>No organization with that id, or you are not a member of it.</AdminPlaceholder>
      ) : (
        <div className="flex flex-col gap-10">
          <FeatureGate
            allOf={[FEATURE.organizationUpdate]}
            fallback={
              <section>
                <h2 className="text-lg font-medium">Organization</h2>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Name</dt>
                    <dd className="mt-0.5">{detail.name}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Key</dt>
                    <dd className="mt-0.5">{detail.key}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Description</dt>
                    {/*
                      An em dash for a row written before the column existed and
                      never touched since. Every write path supplies one, so this
                      is a legacy state rather than a normal one.
                    */}
                    <dd className="mt-0.5">{detail.description ?? '—'}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  Only somebody who can manage this organization may change these.
                </p>
              </section>
            }
          >
            <section>
              <h2 className="text-lg font-medium">Organization</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
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
                  <p className="mt-1 text-xs text-muted-foreground">
                    A label, not an identity — safe to change when the company rebrands.
                  </p>
                </div>
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
                    {/*
                      Uniqueness is left to the database index rather than
                      pre-checked here. A pre-check is a race — two renames onto
                      one key can both pass it — and the constraint is the thing
                      that is actually true.
                    */}
                    Unique across the platform. It appears in URLs; the organization is addressed by its id everywhere
                    else, so changing it breaks no links this app holds.
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <label htmlFor={descriptionId} className="mb-1 block text-sm font-medium">
                  Description
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
                    Said plainly, because the value people find here on their
                    first visit is the NAME — copied in when the column was
                    added so the field would not read as blank. It is a
                    placeholder, not something anybody wrote.
                  */}
                  What this organization is. New organizations start with their name here; replace it with something
                  that tells your people what they are looking at. Left empty, it falls back to the name again.
                </p>
              </div>

              <button
                type="button"
                disabled={busy || !dirty || !key.trim() || !name.trim()}
                onClick={() =>
                  void run('Organization saved.', async () => {
                    await api.renameMyOrganization(detail.id, key.trim(), name.trim(), description.trim() || null);
                    return { changed: true };
                  })
                }
                className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                Save
              </button>
            </section>
          </FeatureGate>

          {/*
            Leaving is offered to a MEMBER, and only to a member. Platform staff
            reading this page hold no membership here, so there is nothing for
            them to leave — showing them the control would offer an action that
            fails with "you are not a member of this organization".
          */}
          {isMember ? (
            <section className="border-t border-border pt-4">
              <h2 className="text-sm font-medium">Leave this organization</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Your role here and your workspace memberships go with you. Your account is untouched, and you can be
                invited back.
              </p>
              {wouldEmpty ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  You are the last member. Add somebody else first — an organization with nobody in it cannot be reached
                  by anyone.
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setLeaving(true)}
                disabled={busy || wouldEmpty}
                className="mt-2 text-sm text-destructive hover:underline disabled:opacity-60 disabled:no-underline"
              >
                Leave {detail.name}
              </button>
            </section>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={leaving}
        title={`Leave ${detail?.name ?? ''}?`}
        confirmLabel="Leave"
        danger
        pending={busy}
        description={
          <>
            You will lose your role here and your place in every workspace of this organization. Nothing else about your
            account changes, and somebody inside can invite you back.
          </>
        }
        onConfirm={() => {
          setLeaving(false);
          if (!detail) return;
          void (async () => {
            try {
              await api.leaveOrganization(detail.id);
              /*
               * A full navigation, not a re-read. The page we are on is gated
               * on a key that came from a membership that no longer exists, so
               * re-reading it renders a denial at somebody who just succeeded.
               * `/organizations` is the one page in this area reachable with no
               * membership anywhere.
               */
              window.location.assign(ORGANIZATIONS_HREF);
            } catch (cause) {
              void run('Left the organization.', () => Promise.reject(cause));
            }
          })();
        }}
        onCancel={() => setLeaving(false)}
      />
    </TenantPage>
  );
}
