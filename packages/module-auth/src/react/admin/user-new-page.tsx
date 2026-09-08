'use client';

import { useMemo } from 'react';
import { AUTH_FEATURE } from '../../features.js';
import { AdminShell } from './admin-shell.js';
import { UserForm } from './user-form.js';
import { createUsersAdminClient, type UsersAdminClient } from './users-admin-client.js';

/**
 * /admin/users/new — creating an account without an invitation.
 *
 * ## Why this exists when sign-up deliberately does not
 *
 * There is no public registration page, and PLAN §12 open decision 36 says that
 * has to stay a product decision rather than something arrived at by leaving an
 * endpoint exposed. This is the third way an account can come into being —
 * after the seed and an invitation — and it is defensible where an open form is
 * not: it is guarded by `users:create`, app level and privileged, and every use
 * of it has an administrator behind it.
 *
 * ## It REDIRECTS to the new account, where the create form does not
 *
 * The same split the roles screens make: creating lands you on the thing you
 * created, because the next thing anybody does is look at it — send the reset,
 * check the name. Editing stays put, because the next thing is another edit.
 *
 * ## The password is temporary, and the form says so
 *
 * Whoever types it knows it. There is no "must change at first sign-in" flag in
 * the schema, and a checkbox that nothing enforces would be worse than saying
 * plainly what the situation is. The better flow — create the account and email
 * a reset instead of asking for a password — needs an account to exist in a
 * passwordless state, which `createAccount` deliberately does not allow: it
 * writes the user and the credential in one transaction precisely so no account
 * can exist that cannot sign in.
 */
export function UserNewPage({
  client,
  listHref = '/admin/users',
  detailHref = (userId: string) => `/admin/users/${encodeURIComponent(userId)}`,
}: {
  client?: UsersAdminClient;
  listHref?: string;
  detailHref?: (userId: string) => string;
}) {
  const api = useMemo(() => client ?? createUsersAdminClient(), [client]);

  return (
    <AdminShell
      title="New user"
      description="Creates an account directly, without an invitation."
      feature={AUTH_FEATURE.usersCreate}
      layout="prose"
      backTo={{ href: listHref, label: 'Users' }}
    >
      <UserForm
        client={api}
        cancelHref={listHref}
        // A full navigation rather than a router push: the module ships no
        // router, and the destination reads the account fresh either way.
        onCreated={(created) => window.location.assign(detailHref(created.id))}
      />
    </AdminShell>
  );
}
