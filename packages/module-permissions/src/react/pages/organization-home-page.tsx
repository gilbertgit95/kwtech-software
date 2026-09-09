'use client';

import { useIconSet } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import type { PermissionsClient, SubscriptionView } from '../permissions-client.js';
import { createPermissionsClient } from '../permissions-client.js';
import { ORGANIZATIONS_HREF, organizationSectionHref } from '../tenant-nav.js';
import { usePermissions } from '../use-permissions.js';
import { AdminPlaceholder } from './admin-page.js';
import { OrganizationNotices } from './organization-notices.js';
import { TenantPage } from './tenant-page.js';
import { useMyOrganization } from './use-my-organization.js';

/**
 * `/organizations/:organizationId` — the tenant's own front door.
 *
 * ## What it is for
 *
 * Answering "where am I, what is here, and what may I do about it" in one
 * screen. Everything on it is a count plus a way in; nothing is edited here.
 * That is deliberate — a landing page that also edits is a page people are
 * afraid to open.
 *
 * ## The cards are FILTERED BY GRANT, not greyed out
 *
 * A member who cannot manage people does not see a Members card at all, rather
 * than one that turns them away. The keys are the same ones on the route
 * descriptors, so a card and the page it points at can never disagree — which
 * is the whole reason both read one declaration.
 *
 * The exception is the counts on this page, which everyone holding
 * `organization:read` sees. Knowing that your company has eleven people and two
 * workspaces is not the same disclosure as being able to list or change them.
 */
export function OrganizationHomePage({
  organizationId,
  client,
}: {
  organizationId: string | undefined;
  client?: PermissionsClient;
}) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const { detail, error, notice } = useMyOrganization(api, organizationId);
  const permissions = usePermissions();
  const iconSet = useIconSet();
  const iconsByName = useMemo(() => new Map((iconSet ?? []).map((option) => [option.name, option.Icon])), [iconSet]);

  /*
   * The plan, read separately and FAILING SOFT to null.
   *
   * `subscriptions:read` is a different key from the one that opened this page,
   * so a reader who may be here and may not see what the company bought is a
   * legitimate configuration — and the honest result for them is a card that is
   * absent rather than a page that refuses. The same arrangement the admin
   * organization list uses for its plan column.
   */
  const [plan, setPlan] = useState<SubscriptionView | null | undefined>(undefined);
  const loadPlan = useCallback(async () => {
    if (!organizationId) return;
    try {
      const rows = await api.listMyOrganizationSubscriptions(organizationId);
      setPlan(organizationWidePlan(rows) ?? null);
    } catch {
      setPlan(undefined);
    }
  }, [api, organizationId]);
  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  const activeMembers = detail?.members.filter((member) => member.status === 'active').length ?? 0;
  const liveWorkspaces = detail?.workspaces.filter((workspace) => !workspace.archived).length ?? 0;
  const pendingInvitations = detail?.invitations.filter((invitation) => invitation.state === 'pending').length ?? 0;

  /*
   * The viewer's own role IN THIS ORGANIZATION, which is not the badge in the
   * header — that one is app level and the same everywhere (see
   * `PermissionContext.appRoles`). This is the answer to "what am I here",
   * which differs per tenant and is the reason the level exists.
   *
   * Read off the members list rather than from the context, because the context
   * carries the resolved KEYS and not the role that produced them.
   */
  const myRole = detail?.members.find((member) => member.userId === permissions?.subjectId)?.roles[0];
  const MyRoleIcon = myRole?.icon ? iconsByName.get(myRole.icon) : undefined;

  return (
    <TenantPage
      title={detail?.name ?? 'Organization'}
      /*
       * Always the KEY here, and the description gets a field of its own below.
       *
       * This briefly showed the description instead, falling back to the key
       * when the two were equal — which is EVERY organization, because the
       * column is backfilled from the name. The field was therefore invisible
       * on the one page somebody would look for it, and a value you cannot see
       * is one you cannot tell is a placeholder.
       */
      description={detail ? `Key: ${detail.key}` : undefined}
      feature={FEATURE.organizationRead}
      backTo={{ href: ORGANIZATIONS_HREF, label: 'Organizations' }}
    >
      <OrganizationNotices error={error} notice={notice} />

      {detail === undefined ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : !detail ? (
        <AdminPlaceholder>
          No organization with that id, or you are not a member of it. Those look the same from here on purpose.
        </AdminPlaceholder>
      ) : (
        <div className="flex flex-col gap-8">
          {myRole ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              You are
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-foreground">
                {MyRoleIcon ? <MyRoleIcon aria-hidden="true" className="size-3.5" /> : null}
                {myRole.label}
              </span>
              here.
            </p>
          ) : null}

          {/*
            Its own labelled block rather than a subtitle, so it is always
            visible and always identifiable. When it still equals the name — the
            state every organization starts in — that reads as a field holding a
            placeholder, which is the truth, where the same string used as a
            subtitle would just look like the heading repeated.
          */}
          <div className="rounded-lg border border-border px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Description</p>
            <p className="mt-1 text-sm">
              {detail.description ?? <span className="text-muted-foreground">Not set</span>}
            </p>
            {detail.description === detail.name ? (
              <p className="mt-1 text-xs text-muted-foreground">
                This is the name, copied in as a starting value. Change it in Settings.
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Members"
              value={activeMembers}
              note={pendingInvitations ? `${pendingInvitations} invited` : undefined}
            />
            <Stat label="Workspaces" value={liveWorkspaces} />
            {/*
              Three states, and the em dash is not the same as "No plan". The
              subscriptions read is behind its own key, so a legitimate reader
              may be unable to see what the company bought — saying "No plan"
              at them would be a confident wrong answer.
            */}
            <Stat label="Plan" value={plan === undefined ? '—' : (plan?.planLabel ?? 'No plan')} />
          </div>

          <nav aria-label="This organization" className="grid gap-3 sm:grid-cols-2">
            <FeatureGate allOf={[FEATURE.membersRead]}>
              <Card
                href={organizationSectionHref(detail.id, 'members')}
                title="Members"
                description="Who is in this organization, what role each holds, and who has been invited."
              />
            </FeatureGate>
            <FeatureGate allOf={[FEATURE.workspacesRead]}>
              <Card
                href={organizationSectionHref(detail.id, 'workspaces')}
                title="Workspaces"
                description="The workspaces here, who is in each, and what they may do once inside."
              />
            </FeatureGate>
            <FeatureGate allOf={[FEATURE.subscriptionsRead]}>
              <Card
                href={organizationSectionHref(detail.id, 'subscription')}
                title="Subscription"
                description="The plan this organization is on and what it entitles."
              />
            </FeatureGate>
            {/*
              Settings is offered to everybody holding `organization:read`, not
              only to somebody who may rename — because leaving lives there too,
              and leaving is not a right an administrator grants. The rename
              form inside is gated on its own key.
            */}
            <Card
              href={organizationSectionHref(detail.id, 'settings')}
              title="Settings"
              description="This organization's name and key, and the way out of it."
            />
          </nav>
        </div>
      )}
    </TenantPage>
  );
}

/**
 * The organization-wide subscription that is actually entitling.
 *
 * Three conditions, each of which has bitten somewhere in this codebase:
 * `active` because a canceled row still names a plan; an unarchived plan
 * because an archived one entitles nothing however live the row looks; and
 * `workspaceId === null` because a workspace's own plan ADDS to the
 * organization's rather than being it — reporting one here would tell a company
 * it is subscribed on the strength of a plan covering one workspace.
 */
function organizationWidePlan(subscriptions: readonly SubscriptionView[]) {
  return subscriptions.find((row) => row.workspaceId === null && row.status === 'active' && !row.planArchived);
}

function Stat({ label, value, note }: { label: string; value: number | string; note?: string | undefined }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
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
