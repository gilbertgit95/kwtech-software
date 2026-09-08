'use client';

import { useHoldsFeature } from '@kwtech/module-kit/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUTH_FEATURE } from '../../features.js';
import { AdminShell } from './admin-shell.js';
import { type AdminUser, createUsersAdminClient, type UsersAdminClient } from './users-admin-client.js';

/**
 * Every account on the platform.
 *
 * ## This screen is the enumeration `findUserByEmail` refuses to be
 *
 * That query answers one question about one address at a time, so a tenant
 * administrator holding `members:manage` cannot harvest the platform's user
 * list. This is that harvest, and it is correct here: `users:read` is app
 * level, privileged, and held by the back office rather than by customers. Same
 * judgement, opposite answer, different holder — see ../../features.ts.
 *
 * ## Paged on the SERVER
 *
 * `adminUsers` takes skip and take and returns a total, so the browser never
 * holds more than a page. The alternative — fetch everything and page in
 * memory, which is what the roles and plans lists do — is right for a catalogue
 * of twenty and wrong for a table that grows with the business.
 *
 * ## Read-only, like the other lists
 *
 * Nothing here changes an account. Suspension and resets live on the DETAIL
 * page, next to the account they act on and the history that says whether they
 * are a good idea — a suspend button in a row is one mis-click away from
 * locking out the wrong person with a similar name.
 *
 * The two things a row DOES offer are navigations: the name opens the account,
 * and a double click — or the Edit link — opens its editor, which is the
 * shortcut the roles grid has had all along.
 */

const PAGE_SIZE = 25;

export function UsersPage({
  client,
  newHref = '/admin/users/new',
  detailHref = (userId: string) => `/admin/users/${encodeURIComponent(userId)}`,
  editHref = (userId: string) => `/admin/users/${encodeURIComponent(userId)}/edit`,
}: {
  client?: UsersAdminClient;
  newHref?: string;
  detailHref?: (userId: string) => string;
  editHref?: (userId: string) => string;
}) {
  const api = useMemo(() => client ?? createUsersAdminClient(), [client]);

  /*
   * Both affordances are gated, and both routes are gated too — so an ungated
   * link would land somebody on the shell's "not available to you" screen,
   * which is a worse answer than not offering the link. (An earlier version
   * left New visible on the argument that a refusal names the missing right.
   * That holds for a button that submits; it does not hold for a link into a
   * route the middleware already refuses.)
   */
  const mayCreate = useHoldsFeature(AUTH_FEATURE.usersCreate);
  const mayEdit = useHoldsFeature(AUTH_FEATURE.usersUpdate);

  /**
   * Double-clicking a row opens the EDITOR — the same shortcut the roles grid
   * offers through `DataGrid.onRowActivate`, implemented by hand because this
   * table is plain markup.
   *
   * DOUBLE click, not single: a single click is how somebody selects text in a
   * cell, and making it navigate would mean nobody could read an address
   * without leaving the page. It is also deliberately not the only way there —
   * a double click is unfindable and impossible on a touchscreen, so every row
   * carries a visible Edit link to the same place.
   */
  const openEditor = useCallback(
    (userId: string) => {
      if (!mayEdit) return;
      // The browser has already selected the text under a double click by the
      // time this runs; leaving it highlighted through the navigation looks
      // like a stuck selection.
      window.getSelection()?.removeAllRanges();
      window.location.assign(editHref(userId));
    },
    [mayEdit, editHref],
  );

  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'suspended'>('');
  const [error, setError] = useState<string | null>(null);

  /*
   * The search is DEBOUNCED, and the timer is the reason this page does not
   * send a query per keystroke. 300ms is long enough to swallow typing and
   * short enough that the list feels answerable.
   */
  const [term, setTerm] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setTerm(search.trim());
      // Back to the first page: page 4 of a different filter is a page that
      // may not exist, and an empty table reads as "no accounts" rather than
      // as "you are past the end".
      setPage(0);
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [search]);

  const load = useCallback(() => {
    let cancelled = false;
    api
      .listUsers({
        ...(term ? { search: term } : {}),
        ...(status ? { status } : {}),
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
      })
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTotal(result.total);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load accounts.');
      });
    return () => {
      cancelled = true;
    };
  }, [api, term, status, page]);

  useEffect(load, [load]);

  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0);

  return (
    <AdminShell
      title="Users"
      description="Every account on the platform."
      feature={AUTH_FEATURE.usersRead}
      actions={
        mayCreate ? (
          <a
            href={newHref}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            New user
          </a>
        ) : null
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by email, name or username"
          aria-label="Search accounts"
          className="h-9 w-72 rounded-md border border-border bg-background px-3 text-sm text-foreground"
        />
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as '' | 'active' | 'suspended');
            setPage(0);
          }}
          aria-label="Filter by status"
          className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
        >
          <option value="">All accounts</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <span className="ml-auto text-sm text-muted-foreground">
          {rows === null ? 'Loading…' : `${total} account${total === 1 ? '' : 's'}`}
        </span>
      </div>

      {error ? (
        <p className="mb-4 rounded-md bg-[var(--status-danger)] px-3 py-2 text-sm text-[var(--status-danger-foreground)]">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Username</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Last signed in</th>
              <th className="px-3 py-2 font-medium">Created</th>
              {/* Unlabelled: the column holds one link per row, and "Actions"
                  over a single verb is a heading that says less than the link. */}
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows?.map((row) => (
              <tr
                key={row.id}
                onDoubleClick={() => openEditor(row.id)}
                /*
                 * `select-none` only because the row is double-clickable: the
                 * gesture would otherwise highlight whatever it landed on. The
                 * address is still readable from the detail page, where nothing
                 * suppresses selection.
                 */
                className={`border-t border-border hover:bg-muted/50 ${mayEdit ? 'cursor-pointer select-none' : ''}`}
                title={mayEdit ? 'Double-click to edit' : undefined}
              >
                <td className="px-3 py-2">
                  <a href={detailHref(row.id)} className="font-medium text-foreground hover:underline">
                    {row.displayName ?? row.email}
                  </a>
                  {/* The address always, even when it is also the link text: it
                      is the account's identifier, and a list of display names
                      alone cannot tell two Someones apart. */}
                  <div className="text-xs text-muted-foreground">{row.email}</div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{row.username ?? '—'}</td>
                <td className="px-3 py-2">
                  <StatusPill status={row.status} />
                </td>
                <td className="px-3 py-2 text-muted-foreground">{formatDate(row.lastLoginAt)}</td>
                <td className="px-3 py-2 text-muted-foreground">{formatDate(row.createdAt)}</td>
                <td className="px-3 py-2 text-right">
                  {mayEdit ? (
                    <a
                      href={editHref(row.id)}
                      /*
                       * Stops the link's click from counting toward a double
                       * click on the row — without it, a slow double click on
                       * the link itself navigates twice.
                       */
                      onDoubleClick={(event) => event.stopPropagation()}
                      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Edit
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
            {rows?.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {term || status ? 'No accounts match that.' : 'No accounts yet.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(current - 1, 0))}
            disabled={page === 0}
            className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-muted-foreground">
            Page {page + 1} of {lastPage + 1}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(current + 1, lastPage))}
            disabled={page >= lastPage}
            className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      ) : null}
    </AdminShell>
  );
}

function StatusPill({ status }: { status: string }) {
  const suspended = status === 'suspended';
  return (
    <span
      className={
        suspended
          ? 'rounded-full bg-[var(--status-warning)] px-2 py-0.5 text-xs text-[var(--status-warning-foreground)]'
          : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
      }
    >
      {suspended ? 'Suspended' : 'Active'}
    </span>
  );
}

/**
 * Dates render in the READER's locale, and never as a raw ISO string.
 *
 * Null is an em dash rather than "Never": for `lastLoginAt` the two are the
 * same fact, and for a column that may later carry other nullable dates a dash
 * does not assert anything.
 */
function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}
