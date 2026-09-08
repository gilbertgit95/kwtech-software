'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AUTH_FEATURE } from '../../features.js';
import { AdminShell } from './admin-shell.js';
import { UserForm } from './user-form.js';
import { type AdminUser, createUsersAdminClient, type UsersAdminClient } from './users-admin-client.js';

/**
 * /admin/users/:userId/edit — change an account's name and username.
 *
 * The twin of `/admin/roles/:roleId/edit`, deliberately: a separate route
 * rather than a panel on the detail page, sharing its form with the create
 * screen, and gated on the WRITE key rather than the read one.
 *
 * ## Why the profile form moved off the detail page
 *
 * It started there, inline, hidden from anyone without the write key. That made
 * the detail page two things at once — a record to read and a form to submit —
 * and it meant an administrator with read access saw a page that silently
 * changed shape depending on what they held. Splitting them gives the reader
 * one page that only shows, and the editor one route that only edits, which is
 * the arrangement every other admin surface here already uses.
 *
 * ## It STAYS on the page after saving
 *
 * Like the role editor, and unlike the create screen which redirects. Editing
 * is often a name and then a username; bouncing to the list after each save
 * would cost a navigation per field. The form shows its own confirmation.
 */
export function UserEditPage({
  userId,
  client,
  listHref = '/admin/users',
  detailHref = (id: string) => `/admin/users/${encodeURIComponent(id)}`,
}: {
  userId: string;
  client?: UsersAdminClient;
  listHref?: string;
  detailHref?: (userId: string) => string;
}) {
  const api = useMemo(() => client ?? createUsersAdminClient(), [client]);
  const [user, setUser] = useState<AdminUser | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  /*
   * Read separately from the account, because it lives in another module's
   * table. Undefined until the answer arrives, so the picker does not open on
   * "no role" for somebody who holds one.
   */
  const [appRoleId, setAppRoleId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    api
      .getUser(userId)
      .then((row) => {
        if (!cancelled) setUser(row);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Could not load this account.');
        setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, userId]);

  /*
   * Holds the SAVED row, so the form's "changed?" comparison is against what
   * the server now has rather than against what the page loaded. Without it a
   * second save would resend the first save's values as though they were still
   * changes.
   */
  useEffect(() => {
    let cancelled = false;
    api.listUserAppRoles([userId]).then((found) => {
      if (!cancelled) setAppRoleId(found[0]?.roleId ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [api, userId]);

  const onSaved = useCallback((updated: AdminUser) => setUser(updated), []);

  return (
    <AdminShell
      title={user ? `Edit ${user.displayName ?? user.email}` : 'Edit account'}
      description="The email address cannot change — invitations, member lookups and password resets all read it."
      feature={AUTH_FEATURE.usersUpdate}
      layout="prose"
      backTo={user ? { href: detailHref(user.id), label: 'Back to the account' } : { href: listHref, label: 'Users' }}
    >
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-[var(--status-danger)] px-3 py-2 text-sm text-[var(--status-danger-foreground)]"
        >
          {error}
        </p>
      ) : user === undefined ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : user === null ? (
        <p className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
          No account with that id. It may have been removed.
        </p>
      ) : (
        <>
          {user.status === 'suspended' ? (
            /*
             * The suspension belongs HERE as well as on the detail page.
             * Somebody who opened an account to fix a name needs to know it
             * currently cannot sign in — otherwise they save, and wonder why
             * nothing they did helped.
             */
            <div className="mb-6 rounded-md border border-[var(--status-warning)] px-4 py-3 text-sm">
              This account is suspended. Editing it is fine — it still cannot sign in until the suspension is lifted
              from its own page.
            </div>
          ) : null}

          {appRoleId === undefined ? (
            <div className="h-64 animate-pulse rounded-md bg-muted" />
          ) : (
            <UserForm
              client={api}
              user={user}
              currentAppRoleId={appRoleId}
              onSaved={onSaved}
              cancelHref={detailHref(user.id)}
            />
          )}
        </>
      )}
    </AdminShell>
  );
}
