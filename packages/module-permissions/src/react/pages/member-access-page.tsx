'use client';

import { useEffect, useMemo, useState } from 'react';
import { type AccessLine, accessReasonText } from '../../domain/access-explanation.js';
import { FEATURE } from '../../feature-keys.js';
import {
  type AccessExplanationView,
  createPermissionsClient,
  type FoundUser,
  type PermissionsClient,
} from '../permissions-client.js';
import { organizationSectionHref, workspaceHref } from '../tenant-nav.js';
import { type AccessFilter, accessSummary, groupAccessLines, isYes, moduleHeading } from '../view/access-view.js';
import { AdminPlaceholder } from './admin-page.js';
import { personLabel } from './person.js';
import { TenantPage } from './tenant-page.js';

/**
 * `/organizations/:organizationId[/workspaces/:workspaceId]/members/:userId/access`:
 * one member's access, every permission with yes or no and why (#173, the
 * last item of #25).
 *
 * ⚠ GATED ON `organization:read`, like the workspace's Members page, because
 * the most common visitor is a member asking about THEMSELVES, who may hold
 * nothing more. Whether they may see SOMEBODY ELSE's is the API's decision
 * (`explainAccess`: the key that changes that person's role), and its refusal
 * is shown here in its own words.
 *
 * Each line's sentence is `accessReasonText`, the domain's, so the page and
 * any other surface say the same thing about the same grant.
 */
export function MemberAccessPage({
  organizationId,
  workspaceId,
  userId,
  client,
}: {
  organizationId: string | undefined;
  workspaceId?: string | undefined;
  userId: string | undefined;
  client?: PermissionsClient;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const [view, setView] = useState<AccessExplanationView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState<FoundUser | undefined>(undefined);
  const [filter, setFilter] = useState<AccessFilter>('all');

  useEffect(() => {
    if (!organizationId || !userId) {
      setView(null);
      return;
    }
    let cancelled = false;
    setView(undefined);
    setError(null);
    api
      .explainAccess({ organizationId, workspaceId: workspaceId ?? null, userId })
      .then((found) => {
        if (!cancelled) setView(found);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setView(null);
        setError(cause instanceof Error ? cause.message : 'Could not load their access.');
      });
    /*
     * The name is a nicety: it needs `members:read` (module-auth's lookup), and
     * a member reading their own access may not hold it. Without it the page
     * says "Your access" or shows the id, and the explanation is unaffected.
     */
    api
      .findUsersByIds(organizationId, [userId])
      .then((found) => {
        if (!cancelled) setPerson(found[0]);
      })
      .catch(() => {
        if (!cancelled) setPerson(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [api, organizationId, workspaceId, userId]);

  const groups = useMemo(() => groupAccessLines(view?.lines ?? [], filter), [view, filter]);
  const subject = view?.self ? 'self' : 'other';
  const title = view?.self ? 'Your access' : `Access: ${personLabel(person, userId ?? '')}`;
  const membersHref = workspaceId
    ? `${workspaceHref(organizationId ?? '', workspaceId)}/members`
    : organizationSectionHref(organizationId ?? '', 'members');

  return (
    <TenantPage
      organizationId={organizationId}
      title={title}
      description={workspaceId ? 'In this workspace' : 'In this organization'}
      feature={FEATURE.organizationRead}
      backTo={{ href: membersHref, label: 'Members' }}
    >
      {view === undefined ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : view === null ? (
        <AdminPlaceholder>{error ?? 'Could not load their access.'}</AdminPlaceholder>
      ) : (
        <section aria-labelledby="access-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="access-heading" className="text-lg font-medium">
                {accessSummary(view.lines)}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each permission {workspaceId ? 'here and across the organization' : 'across the organization'}, and why.
                A permission needs a role that includes it and, for most, a plan that includes it too.
                {/* No date: a day belongs to a workspace's time zone, and this may be the organization's page. */}
                {view.subscriptionEndedAt
                  ? " The organization's paid plan has ended, so only what the free plan includes is allowed."
                  : ''}
              </p>
            </div>
            <fieldset className="flex gap-1 text-sm">
              <legend className="sr-only">Show</legend>
              {(['all', 'yes', 'no'] as const).map((option) => (
                <label
                  key={option}
                  className="cursor-pointer rounded-md border border-border px-3 py-1 has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input
                    type="radio"
                    name="access-filter"
                    value={option}
                    checked={filter === option}
                    onChange={() => setFilter(option)}
                    className="sr-only"
                  />
                  {option === 'all' ? 'All' : option === 'yes' ? 'Allowed' : 'Not allowed'}
                </label>
              ))}
            </fieldset>
          </div>

          {groups.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nothing to show with this filter.</p>
          ) : (
            groups.map((group) => (
              <div key={group.module} className="mt-4 rounded-lg border border-border">
                <h3 className="border-b border-border px-4 py-2 text-sm font-medium">{moduleHeading(group.module)}</h3>
                <ul>
                  {group.lines.map((line) => (
                    <AccessRow key={line.key} line={line} subject={subject} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      )}
    </TenantPage>
  );
}

function AccessRow({ line, subject }: { line: AccessLine; subject: 'self' | 'other' }) {
  const yes = isYes(line.verdict);
  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-border/50 px-4 py-2 last:border-b-0">
      <span
        className={
          yes
            ? 'mt-0.5 rounded-full bg-status-success px-2 py-0.5 text-xs font-medium text-status-success-foreground'
            : 'mt-0.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
        }
      >
        {yes ? 'Yes' : 'No'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium" title={line.description}>
          {line.label}
        </span>
        <span className="block text-sm text-muted-foreground">{accessReasonText(line, subject)}</span>
      </span>
    </li>
  );
}
