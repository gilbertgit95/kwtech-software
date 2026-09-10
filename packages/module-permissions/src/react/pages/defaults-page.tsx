'use client';

import { useIconSet } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type AppDefaultKind, appDefaultRoleLevel } from '../../defaults.js';
import { FEATURE } from '../../feature-keys.js';
import { FeatureGate } from '../feature-gate.js';
import {
  createPermissionsClient,
  type DefaultView,
  type PermissionsClient,
  type PlanView,
  type RoleView,
} from '../permissions-client.js';
import { AdminPage, AdminPlaceholder } from './admin-page.js';

/**
 * `/admin/defaults` — what the application does when nobody said what to do.
 *
 * ## Why this screen exists
 *
 * The permission model is ADDITIVE, so there is no default-on, and four
 * processes each ended with somebody holding nothing: the founder of a new
 * organization was a member of it with no role, a new workspace's creator could
 * enter it and do nothing, a new organization was on no plan and therefore
 * entitled to nothing, and a new account held nothing at all. Each was patched
 * where it hurt — a module option here, a sentence on a screen there. This is
 * the same question asked in one place.
 *
 * ## It is a POLICY screen, and it says so
 *
 * Every other admin screen changes something that exists. This one changes what
 * will happen to things that do not exist yet, which is a different kind of
 * act: nothing visibly moves when you save, and the consequence arrives with
 * the next sign-up. So the page leads with what each default DOES, shows what
 * happens while it is unset, and never presents an unset default as a problem —
 * unset is a legitimate configuration for all eight, and for most of them it is
 * the behaviour every deployment had before this screen existed.
 *
 * ## ⚠ The warning at the top is not decoration
 *
 * `assignRole` refuses a role carrying features the granter does not hold, so
 * nobody can mint somebody more powerful than themselves. The defaults do not
 * run that check and cannot: a founder's role is granted by the platform, at
 * 3am, with no actor to compare against. So choosing a default IS the
 * escalation decision — one person, once, deciding what every founder from then
 * on will hold. That is what `defaults:manage` hands over, and somebody
 * arriving on this screen should read it before their first save rather than
 * after their first incident.
 *
 * ## Grouped by MOMENT, not by kind
 *
 * Somebody arrives asking "what happens when a workspace is created", not
 * "which of these point at a role". The moment is the question; the kind is an
 * implementation detail that decides which picker gets drawn.
 */

/** The heading each moment gets, in the order somebody moves through the product. */
const MOMENTS: { moment: string; title: string; blurb: string }[] = [
  {
    moment: 'account_created',
    title: 'When an account is created',
    blurb:
      'Every account here is created by following an invitation — platform or organization — so this is what fills in the app-level role when the invitation named none.',
  },
  {
    moment: 'organization_created',
    title: 'When an organization is created',
    blurb:
      'The creator becomes its first member — that always happens, because an organization whose founder is not in it is unreachable. These decide what they hold once they are in, and what the organization is entitled to.',
  },
  {
    moment: 'organization_member_added',
    title: 'When somebody joins an organization',
    blurb:
      'Only where nothing else named a role. An invitation that names one always wins, and an existing member’s role is never overwritten.',
  },
  {
    moment: 'invitation_sent',
    title: 'When an invitation is sent',
    blurb:
      'Applies to both kinds — joining an organization and joining the platform. Expiry is derived from the date on the row, so a shorter window retires invitations already sent as well as future ones.',
  },
  {
    moment: 'workspace_created',
    title: 'When a workspace is created',
    blurb:
      'The creator becomes a member of it, which is what lets them enter at all — workspace membership is required and no role widens it. This decides what they may do once inside.',
  },
  {
    moment: 'workspace_member_added',
    title: 'When somebody is added to a workspace',
    blurb: 'Only where the person adding them named no role.',
  },
];

const SUBSCRIPTION_STATUSES = ['active', 'past_due', 'canceled'];

export function DefaultsPage({ client }: { client?: PermissionsClient }) {
  const api = useMemo(() => client ?? createPermissionsClient(), [client]);
  const iconSet = useIconSet();
  const iconsByName = useMemo(() => new Map((iconSet ?? []).map((option) => [option.name, option.Icon])), [iconSet]);

  const [defaults, setDefaults] = useState<DefaultView[] | null>(null);
  /**
   * The pickers' contents.
   *
   * Loaded HERE rather than per row: five of the eight defaults point at a
   * role, so a fetch per picker would be five requests for one list. Roles are
   * filtered to the GLOBAL ones (`organizationId === null`) for the reason the
   * server validates the same way — a tenant's own role as the founder default
   * would try to grant every new organization a role belonging to somebody
   * else's company.
   */
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, roleRows, planRows] = await Promise.all([api.listDefaults(), api.listRoles(null), api.listPlans()]);
      setDefaults(rows);
      setRoles(roleRows.filter((role) => role.organizationId === null && !role.disabled));
      setPlans(planRows.filter((plan) => !plan.archived));
      setError(null);
    } catch (cause) {
      setDefaults([]);
      setError(cause instanceof Error ? cause.message : 'Could not load the defaults.');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (row: DefaultView, value: string | null) => {
      setSaving(row.key);
      setError(null);
      setNotice(null);
      try {
        await api.setDefault(row.key, value);
        /*
         * Re-read rather than patching the row in place. The server resolves
         * the value to a name and decides whether the target is usable, and
         * guessing either here would make the screen disagree with what will
         * actually happen at the next sign-up.
         */
        await load();
        setNotice(value === null ? `${row.label} — cleared.` : `${row.label} — saved.`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not save that default.');
      } finally {
        setSaving(null);
      }
    },
    [api, load],
  );

  return (
    <AdminPage
      title="Defaults"
      description="What every new account, organization and workspace is created with."
      feature={FEATURE.defaultsRead}
    >
      {/*
        ⚠ READ BEFORE THE FIRST SAVE. See the file's own note — a default is
        granted by the platform, so the no-escalation rule that guards granting
        a role by hand does not and cannot run here.
      */}
      <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        These apply to things that do not exist yet, so nothing visibly changes when you save — the effect arrives with
        the next sign-up. Choosing a role here <strong className="text-foreground">is</strong> the escalation decision:
        granting a role by hand is refused if it carries features you do not hold, and that check cannot run for a role
        the platform grants on its own.
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? <p className="mt-4 rounded-md bg-accent px-3 py-2 text-sm">{notice}</p> : null}

      {defaults === null ? (
        <div className="mt-6 h-64 animate-pulse rounded-md bg-muted" />
      ) : defaults.length === 0 ? (
        <AdminPlaceholder>This build declares no defaults.</AdminPlaceholder>
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {MOMENTS.map((group) => {
            const rows = defaults.filter((row) => row.moment === group.moment);
            /*
             * A moment with no defaults is skipped rather than shown empty. The
             * catalogue drives both lists, so this only happens for a moment
             * whose defaults were retired — and a heading over nothing would
             * read as a screen that failed to load.
             */
            if (rows.length === 0) return null;

            return (
              <section key={group.moment}>
                <h2 className="text-lg font-medium">{group.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{group.blurb}</p>

                <div className="mt-3 flex flex-col gap-3">
                  {rows.map((row) => (
                    <DefaultRow
                      key={row.key}
                      row={row}
                      roles={roles}
                      plans={plans}
                      iconsByName={iconsByName}
                      busy={saving === row.key}
                      onSave={(value) => void save(row, value)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </AdminPage>
  );
}

/**
 * One default: what it does, what it is set to, and the control that changes it.
 *
 * The control is wrapped in a `FeatureGate` rather than the whole page being
 * gated on `defaults:manage`. Reading what the platform does by default is a
 * support question — somebody working out why a customer's founder holds
 * nothing needs to see this without being able to change it — so the page takes
 * `defaults:read` and only the input takes the write key.
 */
function DefaultRow({
  row,
  roles,
  plans,
  iconsByName,
  busy,
  onSave,
}: {
  row: DefaultView;
  roles: readonly RoleView[];
  plans: readonly PlanView[];
  iconsByName: Map<string, React.ComponentType<{ className?: string }>>;
  busy: boolean;
  onSave: (value: string | null) => void;
}) {
  const Icon = row.targetIcon ? iconsByName.get(row.targetIcon) : undefined;
  const level = appDefaultRoleLevel(row.kind as AppDefaultKind);
  /*
   * ⚠ Filtered by LEVEL, which is the constraint easiest to get wrong. A role's
   * level is immutable, and an organization-level role in the app-level slot
   * would be granted and then filtered out by the resolution order — producing
   * accounts that hold nothing for a reason no screen could explain. The server
   * refuses the same thing; this stops it being offered.
   */
  const options = level ? roles.filter((role) => role.level === level) : [];

  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{row.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{row.description}</p>
        </div>

        <FeatureGate
          allOf={[FEATURE.defaultsManage]}
          /*
             Without the write key the VALUE still shows, as text. A reader who
             may see the configuration and not change it needs the answer, not
             a disabled select that makes them wonder what they are missing.
          */
          fallback={
            <p className="text-sm">
              {row.targetLabel ?? row.value ?? <span className="text-muted-foreground italic">Not set</span>}
            </p>
          }
        >
          <DefaultControl row={row} options={options} plans={plans} busy={busy} onSave={onSave} />
        </FeatureGate>
      </div>

      {/*
        THE THREE STATES A VALUE CAN BE IN, and they need different sentences:
        unset, set-and-resolving, and set-but-pointing-at-something that has
        since been deleted, disabled or archived. A screen that showed the third
        as "Not set" would send somebody to set a default that is already set.
      */}
      <p className="mt-2 text-xs text-muted-foreground">
        {row.value === null ? (
          row.whenUnset
        ) : row.targetLabel === null ? (
          <span className="text-destructive">
            Points at something that no longer exists ({row.value}). Nothing is applied — {row.whenUnset}
          </span>
        ) : row.targetUnavailable ? (
          <span className="text-destructive">
            {row.targetLabel} is disabled or archived, so nothing is applied — {row.whenUnset}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            {Icon ? <Icon className="size-3 shrink-0" /> : null}
            <span>Applied: {row.targetLabel}</span>
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * The input for one default, chosen by its KIND.
 *
 * Saved on CHANGE rather than behind a Save button. Each default is one value
 * with no partner field to be consistent with, so a form would add a step
 * without adding a decision — and the row re-reads from the server afterwards,
 * which is the confirmation a Save button would otherwise be providing.
 */
function DefaultControl({
  row,
  options,
  plans,
  busy,
  onSave,
}: {
  row: DefaultView;
  options: readonly RoleView[];
  plans: readonly PlanView[];
  busy: boolean;
  onSave: (value: string | null) => void;
}) {
  const className = 'w-56 rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60';

  if (row.kind === 'days') {
    return (
      <input
        type="number"
        min={1}
        max={3650}
        disabled={busy}
        defaultValue={row.value ?? ''}
        placeholder="No renewal date"
        aria-label={row.label}
        className={className}
        /*
           On BLUR, not on every keystroke: a number field would otherwise save
           `1` on the way to typing `14`, and each of those is a write somebody
           else's audit trail has to explain.
        */
        onBlur={(event) => {
          const next = event.target.value.trim();
          if (next === (row.value ?? '')) return;
          onSave(next === '' ? null : next);
        }}
      />
    );
  }

  const choices =
    row.kind === 'plan'
      ? plans.map((plan) => ({ value: plan.key, label: plan.label }))
      : row.kind === 'subscription_status'
        ? SUBSCRIPTION_STATUSES.map((status) => ({ value: status, label: status }))
        : options.map((role) => ({ value: role.id, label: role.label }));

  return (
    <select
      disabled={busy}
      value={row.value ?? ''}
      aria-label={row.label}
      className={className}
      onChange={(event) => onSave(event.target.value === '' ? null : event.target.value)}
    >
      {/*
        Always offered, and named for what it MEANS rather than "None". Clearing
        a default is a real configuration — for most of these it is the
        behaviour every deployment had before this screen existed.
      */}
      <option value="">Not set</option>
      {/*
        ⚠ A value pointing at something that is gone or unusable is not in
        `choices` — the lists are filtered to what can be chosen — so without
        this the select would silently show the placeholder and the next change
        would look like an edit rather than a fix. It is rendered as its raw
        value, which is what the row's warning line refers to.
      */}
      {row.value !== null && !choices.some((choice) => choice.value === row.value) ? (
        <option value={row.value}>{row.targetLabel ?? row.value} (unavailable)</option>
      ) : null}
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}
