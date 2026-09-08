'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { AUTH_FEATURE } from '../../features.js';
import { AdminShell } from './admin-shell.js';
import {
  type AdminUserDetail,
  type AdminUserSession,
  createUsersAdminClient,
  type UsersAdminClient,
} from './users-admin-client.js';

/**
 * One account, and everything that can be done to it.
 *
 * ## Why every action is here rather than in the list
 *
 * Suspending the wrong person is a mis-click in a table of similar names. On
 * this page the account is named at the top, its history is on screen, and each
 * action says what it will do — which is the difference between a decision and
 * an accident.
 *
 * ## Reading and editing are different pages
 *
 * The profile form used to be here, inline and hidden from anyone without the
 * write key, which made this page two things at once and gave it a shape that
 * changed depending on what the reader held. It now lives at
 * `/admin/users/:userId/edit`, sharing its form with the create screen — the
 * arrangement `/admin/roles/:roleId/edit` already uses.
 *
 * What stays is everything that is an ACT rather than an edit: the reset, the
 * sign-out, the factor removal, the suspension.
 *
 * ## Controls are gated by the key they need
 *
 * `useHoldsFeature` comes from `@kwtech/module-kit/react`, which is how a
 * module asks about permissions without importing the module that resolves
 * them. Hiding a control hides an affordance, not an endpoint — every mutation
 * is authorised again at the API, by the same key named on the button.
 *
 * ## There is no delete
 *
 * Suspension is the off switch and the whole of it. Every membership,
 * invitation and accepted-by record points at the account, and
 * `perm_membership.userId` has no foreign key to `auth_user` (PLAN §12.12), so
 * a delete would leave rows pointing at nobody rather than cascading. The same
 * call `roles:disable` and `plans:archive` make.
 */

export function UserDetailPage({
  userId,
  client,
  backHref = '/admin/users',
  editHref = (id: string) => `/admin/users/${encodeURIComponent(id)}/edit`,
}: {
  userId: string;
  client?: UsersAdminClient;
  backHref?: string;
  editHref?: (userId: string) => string;
}) {
  const api = useMemo(() => client ?? createUsersAdminClient(), [client]);

  const [user, setUser] = useState<AdminUserDetail | null | undefined>(undefined);
  const [sessions, setSessions] = useState<AdminUserSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Sessions are under `users:read` with the rest of reading, so anybody who
   * can open this page sees them. Kept as a named check rather than inlined
   * `true`: it is the same question the panel asks, and the day sessions get a
   * key of their own again this is the one line that changes.
   */
  const mayReadSessions = useHoldsFeature(AUTH_FEATURE.usersRead);

  const load = useCallback(() => {
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

  useEffect(load, [load]);

  /*
   * Sessions are a SECOND query behind a second key, so the page is useful to
   * somebody who may administer accounts but not read whereabouts — they simply
   * do not see the panel. Asking anyway and hiding the result would send the
   * request and get a refusal in the console.
   */
  useEffect(() => {
    if (!mayReadSessions) return;
    let cancelled = false;
    api
      .listSessions(userId)
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, userId, mayReadSessions]);

  /**
   * One wrapper for every action, so each of them reloads, reports and clears
   * the previous message identically. Written once because the fifth action
   * written by hand is the one that forgets to re-read.
   */
  const run = useCallback(
    async (what: string, action: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await action();
        setNotice(what);
        load();
        if (mayReadSessions) setSessions(await api.listSessions(userId).catch(() => []));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That did not work.');
      } finally {
        setBusy(false);
      }
    },
    [api, load, mayReadSessions, userId],
  );

  if (user === undefined) {
    return (
      <AdminShell
        title="Account"
        feature={AUTH_FEATURE.usersRead}
        layout="prose"
        backTo={{ href: backHref, label: 'Users' }}
      >
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      </AdminShell>
    );
  }

  if (user === null) {
    return (
      <AdminShell
        title="Account not found"
        description="It may have been deleted."
        feature={AUTH_FEATURE.usersRead}
        layout="prose"
        backTo={{ href: backHref, label: 'Users' }}
      >
        {error ? <p className="text-sm text-[var(--status-danger-foreground)]">{error}</p> : null}
      </AdminShell>
    );
  }

  const suspended = user.status === 'suspended';

  return (
    <AdminShell
      title={user.displayName ?? user.email}
      description={user.email}
      feature={AUTH_FEATURE.usersRead}
      layout="prose"
      backTo={{ href: backHref, label: 'Users' }}
      actions={<EditLink href={editHref(user.id)} />}
    >
      {notice ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-foreground" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-[var(--status-danger)] px-3 py-2 text-sm text-[var(--status-danger-foreground)]">
          {error}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 rounded-md border border-border p-4 text-sm">
        <Fact label="Status" value={suspended ? 'Suspended' : 'Active'} />
        <Fact label="Two-step verification" value={user.hasTwoFactor ? 'On' : 'Off'} />
        <Fact label="Signed in on" value={`${user.activeSessions} device${user.activeSessions === 1 ? '' : 's'}`} />
        <Fact label="Last signed in" value={formatDateTime(user.lastLoginAt)} />
        <Fact label="Created" value={formatDateTime(user.createdAt)} />
        <Fact label="Username" value={user.username ?? '—'} />
      </dl>

      {mayReadSessions ? <SessionsSection sessions={sessions} /> : null}

      <section className="rounded-md border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Account actions</h2>
        <div className="mt-3 flex flex-col gap-3">
          <Action
            feature={AUTH_FEATURE.usersUpdate}
            label="Send a password reset"
            /* Says where it goes. An administrator pressing this needs to know
               the link reaches the ACCOUNT's mailbox and not them. */
            hint={`Emails a reset link to ${user.email}. It never sets a password directly.`}
            disabled={busy || suspended}
            onClick={() => run('Password reset sent.', () => api.sendPasswordReset(userId))}
          />

          <Action
            feature={AUTH_FEATURE.usersUpdate}
            label="Sign out everywhere"
            hint="Ends every session immediately. They can sign in again."
            disabled={busy || user.activeSessions === 0}
            onClick={() => run('Signed out of every device.', () => api.revokeSessions(userId))}
          />

          <Action
            feature={AUTH_FEATURE.usersUpdate}
            label="Remove two-step verification"
            hint="For somebody locked out of their own account. Takes the recovery codes with it."
            confirm={`Remove two-step verification from ${user.email}? They will sign in with a password alone until they enrol again.`}
            disabled={busy || !user.hasTwoFactor}
            onClick={() => run('Two-step verification removed.', () => api.removeTwoFactor(userId))}
          />

          <Action
            feature={AUTH_FEATURE.usersDisable}
            label={suspended ? 'Lift the suspension' : 'Suspend this account'}
            hint={
              suspended
                ? 'They can sign in again. Their old sessions are gone and are not restored.'
                : 'Ends every session and refuses new sign-ins. Reversible.'
            }
            confirm={suspended ? undefined : `Suspend ${user.email}? They are signed out everywhere immediately.`}
            disabled={busy}
            onClick={() =>
              run(suspended ? 'Suspension lifted.' : 'Account suspended.', () => api.setSuspended(userId, !suspended))
            }
          />
        </div>
      </section>
    </AdminShell>
  );
}

/**
 * Shown only to somebody who can actually edit.
 *
 * A link, not a button, and gated: a reader with `users:read` alone would
 * otherwise follow it to a page that refuses them, which is a worse answer than
 * not offering it.
 */
function EditLink({ href }: { href: string }) {
  const mayEdit = useHoldsFeature(AUTH_FEATURE.usersUpdate);
  if (!mayEdit) return null;
  return (
    <a href={href} className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
      Edit profile
    </a>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function SessionsSection({ sessions }: { sessions: AdminUserSession[] | null }) {
  return (
    <section className="rounded-md border border-border p-4">
      <h2 className="text-sm font-semibold text-foreground">Signed in on</h2>
      {sessions === null ? (
        <div className="mt-3 h-12 animate-pulse rounded-md bg-muted" />
      ) : sessions.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No live sessions.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap justify-between gap-2 border-b border-border pb-2 last:border-0"
            >
              <span className="text-foreground">{describeAgent(session.userAgent)}</span>
              <span className="text-muted-foreground">
                {session.ipAddress ?? 'unknown address'} · last used {formatDateTime(session.lastUsedAt)}
                {session.mfaSatisfied ? ' · two-step' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A control that appears only for the key it needs, and asks again when it
 * cannot be undone cheaply.
 */
function Action({
  feature,
  label,
  hint,
  confirm,
  disabled,
  onClick,
}: {
  feature: string;
  label: string;
  hint: string;
  confirm?: string | undefined;
  disabled: boolean;
  onClick: () => void;
}) {
  const permitted = useHoldsFeature(feature);
  if (!permitted) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="max-w-md">
        <div className="text-sm text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          // eslint-disable-next-line no-alert -- the module ships no dialog of
          // its own and must not depend on the app's; a native confirm is the
          // one prompt available everywhere. An app wanting its own passes a
          // wrapped client.
          if (confirm && !window.confirm(confirm)) return;
          onClick();
        }}
        className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {label}
      </button>
    </div>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

/**
 * A user agent as something a person can recognise.
 *
 * Deliberately crude — the question this answers is "is one of these not me",
 * and a browser and platform name answers it. Parsing further would be a
 * user-agent library's job and would still be wrong next year.
 */
function describeAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Safari\//.test(userAgent)
        ? 'Safari'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : 'Browser';
  const platform = /Windows/.test(userAgent)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(userAgent)
      ? 'macOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'unknown platform';
  return `${browser} on ${platform}`;
}
