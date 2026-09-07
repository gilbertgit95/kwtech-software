'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { createPermissionsClient, type PermissionsClient } from '../permissions-client.js';
import { AdminPage } from './admin-page.js';

/**
 * /admin/organizations/new — create a tenant.
 *
 * ## Gated on reading, not on creating, and that is not a slip
 *
 * `createOrganization` is guarded by the `user:organizations` LIMIT rather than
 * by a feature: creating an organization is not a right an organization grants,
 * because there is no organization yet to grant it. There IS no key to gate
 * this page on, so it takes `organizations:read` — the key for the area it
 * lives in — and the cap does the real refusing at the write.
 *
 * The practical consequence: any signed-in person may create organizations up
 * to their cap, whatever this page says. `normal-user` allows five.
 *
 * ## The creator becomes the first member
 *
 * In the same transaction, by `createOrganization`. An organization whose
 * founder is not in it is unreachable by anyone and would sit there counting
 * against nobody's cap.
 */
export function OrganizationNewPage({
  client,
  listHref = '/admin/organizations',
  detailHref = (organizationId: string) => `/admin/organizations/${organizationId}`,
}: {
  client?: PermissionsClient;
  listHref?: string;
  detailHref?: (organizationId: string) => string;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const keyId = useId();
  const nameId = useId();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    const trimmedKey = key.trim();
    const trimmedName = name.trim();
    if (!trimmedKey || !trimmedName) {
      setError('A key and a name are both required.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await api.createOrganization(trimmedKey, trimmedName);
      /*
       * Straight to the new tenant's detail screen. It has no members but its
       * founder and no workspaces — which is exactly the state somebody needs
       * to see, because the next thing they do is add both.
       */
      if (result.id) window.location.assign(detailHref(result.id));
      else window.location.assign(listHref);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the organization.');
    } finally {
      setSaving(false);
    }
  }, [api, key, name, detailHref, listHref]);

  return (
    <AdminPage
      title="New organization"
      description="A tenant: its people, its workspaces, and the plan it subscribes to."
      feature={FEATURE.organizationsRead}
      backTo={{ href: listHref, label: 'Organizations' }}
    >
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
            A short, stable handle — <code>acme</code>. Unique across the platform, and referenced by everything the
            tenant owns, so choose one you will not want to change.
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

        <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          You become its first member. The organization starts on no plan, so it is entitled to nothing until a
          subscription is started for it.
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
            {saving ? 'Creating…' : 'Create organization'}
          </button>
          <a href={listHref} className="text-sm text-muted-foreground hover:text-foreground">
            Cancel
          </a>
        </div>
      </div>
    </AdminPage>
  );
}
