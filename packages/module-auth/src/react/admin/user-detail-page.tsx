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
 * ## Each control is gated by its OWN key
 *
 * Nine keys exist so a role can hold the recoverable half of this page without
 * the rest (see ../../features.ts). A page that gated everything behind one
 * check would make that split decorative. `useHoldsFeature` comes from
 * `@kwtech/module-kit/react`, which is how a module asks about permissions
 * without importing the module that resolves them.
 *
 * ⚠ Hiding a control hides an affordance, not an endpoint — every mutation is
 * authorised again at the API, by the same key named on the button.
 *
 * ## The two-step confirmations
 *
 * Suspension, factor removal and deletion each ask again, and the delete asks
 * for the address to be TYPED. That is not ceremony: deletion cannot be undone
 * and it leaves permission rows behind that only the app can clean up.
 */

export function UserDetailPage({
  userId,
  client,
  backHref = '/admin/users',
}: {
  userId: string;
  client?: UsersAdminClient;
  backHref?: string;
}) {
  const api = useMemo(() => client ?? createUsersAdminClient(), [client]);

  const [user, setUser] = useState<AdminUserDetail | null | undefined>(undefined);
  const [sessions, setSessions] = useState<AdminUserSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mayReadSessions = useHoldsFeature(AUTH_FEATURE.usersSessionsRead);

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

      <ProfileSection
        user={user}
        busy={busy}
        onSave={(input) => run('Profile saved.', () => api.updateProfile(userId, input))}
      />

      {mayReadSessions ? <SessionsSection sessions={sessions} /> : null}

      <section className="rounded-md border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Account actions</h2>
        <div className="mt-3 flex flex-col gap-3">
          <Action
            feature={AUTH_FEATURE.usersPasswordReset}
            label="Send a password reset"
            /* Says where it goes. An administrator pressing this needs to know
               the link reaches the ACCOUNT's mailbox and not them. */
            hint={`Emails a reset link to ${user.email}. It never sets a password directly.`}
            disabled={busy || suspended}
            onClick={() => run('Password reset sent.', () => api.sendPasswordReset(userId))}
          />

          <Action
            feature={AUTH_FEATURE.usersSessionsRevoke}
            label="Sign out everywhere"
            hint="Ends every session immediately. They can sign in again."
            disabled={busy || user.activeSessions === 0}
            onClick={() => run('Signed out of every device.', () => api.revokeSessions(userId))}
          />

          <Action
            feature={AUTH_FEATURE.usersTwoFactorRemove}
            label="Remove two-step verification"
            hint="For somebody locked out of their own account. Takes the recovery codes with it."
            confirm={`Remove two-step verification from ${user.email}? They will sign in with a password alone until they enrol again.`}
            disabled={busy || !user.hasTwoFactor}
            onClick={() => run('Two-step verification removed.', () => api.removeTwoFactor(userId))}
          />

          <Action
            feature={AUTH_FEATURE.usersSuspend}
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

      <DangerZone
        user={user}
        busy={busy}
        onDelete={() => run('Account deleted.', () => api.deleteUser(userId))}
        backHref={backHref}
      />
    </AdminShell>
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

function ProfileSection({
  user,
  busy,
  onSave,
}: {
  user: AdminUserDetail;
  busy: boolean;
  onSave: (input: { displayName?: string; username?: string }) => void;
}) {
  const mayWrite = useHoldsFeature(AUTH_FEATURE.usersProfileWrite);
  if (!mayWrite) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get('displayName') ?? '').trim();
    const username = String(form.get('username') ?? '').trim();
    /*
     * Only CHANGED fields are sent. The mutation reads an absent argument as
     * "leave it", so sending both every time would rewrite a username somebody
     * else edited between this page loading and the save.
     */
    onSave({
      ...(displayName !== (user.displayName ?? '') ? { displayName } : {}),
      ...(username !== (user.username ?? '') ? { username } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="rounded-md border border-border p-4">
      <h2 className="text-sm font-semibold text-foreground">Profile</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {/* The one field that is not here, and why — an administrator WILL look
            for it. */}
        The email address is the account's identifier and cannot be changed here.
      </p>

      <label className="mt-3 block text-sm">
        <span className="text-muted-foreground">Display name</span>
        <input
          name="displayName"
          defaultValue={user.displayName ?? ''}
          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-foreground"
        />
      </label>

      <label className="mt-3 block text-sm">
        <span className="text-muted-foreground">Username</span>
        <input
          name="username"
          defaultValue={user.username ?? ''}
          autoComplete="off"
          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-foreground"
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        Save profile
      </button>
    </form>
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

/**
 * Deletion, kept apart from everything else on the page.
 *
 * The address has to be TYPED. A confirm dialog is dismissed by reflex; typing
 * the address is the one interaction that cannot be done without reading which
 * account this is.
 */
function DangerZone({
  user,
  busy,
  onDelete,
  backHref,
}: {
  user: AdminUserDetail;
  busy: boolean;
  onDelete: () => void;
  backHref: string;
}): ReactNode {
  const permitted = useHoldsFeature(AUTH_FEATURE.usersDelete);
  const [typed, setTyped] = useState('');
  if (!permitted) return null;

  return (
    <section className="rounded-md border border-[var(--status-danger)] p-4">
      <h2 className="text-sm font-semibold text-foreground">Delete this account</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Permanent. Credentials, sessions and second factors go with it.{' '}
        <strong>Suspending is reversible and is usually what you want.</strong> Their organization memberships are not
        removed by this and have to be tidied separately.
      </p>

      <label className="mt-3 block text-sm">
        <span className="text-muted-foreground">Type {user.email} to confirm</span>
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-foreground"
        />
      </label>

      <button
        type="button"
        disabled={busy || typed.trim().toLowerCase() !== user.email.toLowerCase()}
        onClick={() => {
          onDelete();
          // Back to the list: staying on the detail page of an account that no
          // longer exists would show a "not found" the reader just caused.
          window.location.assign(backHref);
        }}
        className="mt-4 rounded-md bg-[var(--status-danger)] px-3 py-2 text-sm font-medium text-[var(--status-danger-foreground)] disabled:opacity-50"
      >
        Delete permanently
      </button>
    </section>
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
