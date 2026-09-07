'use client';

import { ConfirmDialog, IconPicker, TreeSelect, type TreeSelectNode, useIconSet } from '@kwtech/web-ui/react';
import { useId, useMemo, useState } from 'react';
import { LIMIT_REGISTRY } from '../../domain/limits.js';
import {
  defaultPlanLimitFields,
  type PlanDraft,
  type PlanDraftErrors,
  planLimitFields,
  validatePlanDraft,
} from '../../domain/plan-draft.js';
import { canPlanEntitle } from '../../domain/plans.js';
import type { RoleLevel } from '../../types.js';
import type { FeatureView, PermissionsClient, PlanView } from '../permissions-client.js';

/** Features nobody filed under a tag. Sorted last, never hidden. */
const UNTAGGED = 'untagged';

/** The caps a plan sells. Role-sourced ones have no meaning here — see domain/limits.ts. */
const PLAN_LIMITS = LIMIT_REGISTRY.filter((spec) => spec.source === 'plan');

/**
 * The one form behind both New and Edit.
 *
 * The entitlement twin of `RoleForm`, and one component rather than two for the
 * same reason that one is: two forms is two places for the field list to drift,
 * and the drift shows up as a field you can set when creating and not when
 * editing.
 *
 * ## One step, not two — the difference from RoleForm
 *
 * Creating a role asks only what it IS, because which features may be offered
 * depends on the role's LEVEL and the list would re-filter under the cursor
 * while somebody was choosing. A plan has no level: the features it may sell
 * are the same two levels for every plan there will ever be (see
 * domain/plans.ts), so there is nothing to settle first and the picker is
 * stable from the start. Splitting this into two screens would be ceremony
 * copied from a constraint that does not exist here.
 *
 * ## What is locked on an edit
 *
 * `key`, and only `key` — it is the primary key, referenced by every
 * subscription and every plan-feature row.
 *
 * ## No no-escalation filter
 *
 * `RoleForm` offers only features the AUTHOR holds, because putting a right
 * into a role you do not have is how one "create roles" key becomes every key.
 * A plan entitles rather than grants: whoever ends up using the feature still
 * needs a role that grants it, and that role is still bound by the rule. So the
 * picker here shows the whole catalogue, which is what somebody defining
 * products actually needs. See `validatePlanFeatures`.
 */

export interface PlanFormProps {
  client: PermissionsClient;
  /** Absent for a new plan. Present to edit one. */
  plan?: PlanView;
  /** Every plan, for the clone picker. */
  allPlans: readonly PlanView[];
  /**
   * Every registered feature, fetched from the API rather than imported.
   *
   * The same fix `RoleForm` documents: read from this package's own registry,
   * the list would omit every feature any other module declared, so cloning a
   * plan that sold one would report it "not in the registry" and silently drop
   * it while the key sat in `perm_feature`, undeprecated and sold.
   */
  features: readonly FeatureView[];
  onSaved: (plan: PlanView) => void;
  cancelHref: string;
}

export function PlanForm({ client, plan, allPlans, features, onSaved, cancelHref }: PlanFormProps) {
  const editing = plan !== undefined;
  /*
   * Name → component, from whatever the app published. Null when no
   * `IconSetProvider` is mounted, in which case the field falls back to a text
   * box — still working, and honest that this frontend cannot enumerate what it
   * can draw. The module never owns the vocabulary; see PermPlan.icon.
   */
  const iconSet = useIconSet();

  const [draft, setDraft] = useState<PlanDraft>({
    key: plan?.key ?? '',
    label: plan?.label ?? '',
    isPublic: plan?.isPublic ?? true,
    icon: plan?.icon ?? '',
    features: plan?.features ?? [],
    /*
     * Prefilled on CREATE, exact on EDIT.
     *
     * A new plan starts every required cap at `DEFAULT_PLAN_LIMIT`, because
     * those caps are required and three blank boxes make a form that cannot be
     * submitted until somebody guesses what belongs in them.
     *
     * An EDIT shows what is stored and nothing else — including a blank where a
     * stored plan is missing a cap, which happens to a plan created before that
     * key entered the registry. Prefilling there would let somebody save a cap
     * they never chose while believing they had only renamed the plan, and the
     * blank is what makes the validator say which field needs a decision.
     */
    limits: plan
      ? planLimitFields(Object.fromEntries(plan.limits.map((limit) => [limit.limitKey, limit.value])))
      : defaultPlanLimitFields(),
  });
  const [errors, setErrors] = useState<PlanDraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /*
   * Cleared on the next edit, not on a timer — the same call RoleForm makes. A
   * confirmation that disappears by itself is one somebody can miss, and on
   * this form a save is often one of several in a row.
   */
  const [saved, setSaved] = useState(false);
  const [cloneFrom, setCloneFrom] = useState<PlanView | null>(null);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [skipped, setSkipped] = useState<{ key: string; reason: string }[]>([]);

  /** Every organization- and workspace-level feature. See the note above on escalation. */
  const selectable = useMemo(
    () =>
      features
        .filter((spec) => canPlanEntitle(spec.level as RoleLevel))
        .slice()
        .sort((a, b) => a.key.localeCompare(b.key)),
    [features],
  );

  /** Every mutation of the draft goes through here, so `saved` cannot go stale. */
  const edit = (next: PlanDraft | ((current: PlanDraft) => PlanDraft)) => {
    setSaved(false);
    setDraft(next);
  };

  /**
   * The selectable features, nested by their TAG PATH — the same tree the role
   * editor builds, and deliberately identical: somebody composing a plan and
   * somebody composing a role are reading the same catalogue, and two different
   * arrangements of it would make the two screens harder to hold together.
   *
   * A feature appears ONCE, at the end of its path. Node ids are the accumulated
   * path so two areas may hold a feature of the same name without colliding,
   * while the VALUE stays the bare key — which is what the selection is made of.
   */
  const tree = useMemo<TreeSelectNode[]>(() => {
    interface Building {
      children: Map<string, Building>;
      leaves: TreeSelectNode[];
    }
    const root: Building = { children: new Map(), leaves: [] };

    for (const spec of selectable) {
      const path = spec.tags?.length ? [...spec.tags] : [UNTAGGED];
      let node = root;
      for (const segment of path) {
        let next = node.children.get(segment);
        if (!next) {
          next = { children: new Map(), leaves: [] };
          node.children.set(segment, next);
        }
        node = next;
      }
      node.leaves.push({ id: `${path.join('/')}/${spec.key}`, value: spec.key, label: spec.label, hint: spec.key });
    }

    const build = (node: Building, prefix: string): TreeSelectNode[] => [
      ...[...node.children.entries()]
        // Untagged last; everything else alphabetical, so the order does not
        // depend on which feature happened to be registered first.
        .sort(([a], [b]) => (a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : a.localeCompare(b)))
        .map(([segment, child]) => ({
          id: `${prefix}${segment}`,
          label: segment,
          children: build(child, `${prefix}${segment}/`),
        })),
      ...[...node.leaves].sort((a, b) => a.label.localeCompare(b.label)),
    ];

    return build(root, '');
  }, [selectable]);

  async function runClone(mode: 'replace' | 'add') {
    if (!cloneFrom) return;
    setCloneBusy(true);
    try {
      const preview = await client.previewPlanClone({
        sourcePlanKey: cloneFrom.key,
        current: draft.features,
        mode,
      });
      edit((current) => ({ ...current, features: preview.features }));
      setSkipped(preview.skipped);
      setCloneFrom(null);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not clone that plan.');
    } finally {
      setCloneBusy(false);
    }
  }

  async function save() {
    /*
     * Validated HERE and again on the server. Not redundant: this one is the
     * fast, per-field answer a form needs, and the server's is the one that
     * must be true — it is reachable from a worker and a CLI with no form in
     * front of it.
     */
    const found = validatePlanDraft(draft, {
      // The same list the server validates against, so the form cannot refuse
      // something the API would accept, or offer something it would not.
      registry: features.map((feature) => ({ ...feature, level: feature.level as RoleLevel })),
      ...(editing ? { originalKey: plan.key } : {}),
    });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setFailure(null);
    try {
      const input = {
        key: draft.key.trim(),
        label: draft.label.trim(),
        isPublic: draft.isPublic,
        icon: draft.icon.trim() || null,
        features: [...draft.features],
        limits: PLAN_LIMITS.map((spec) => ({
          limitKey: spec.key,
          value: (draft.limits[spec.key] ?? '').trim(),
        })).filter(
          // Blanks are dropped rather than sent as empty strings: an absent
          // optional cap means "this plan does not set it", and the server's
          // `planLimitValues` reads absence the same way.
          (limit) => limit.value !== '',
        ),
      };
      onSaved(editing ? await client.updatePlan(plan.key, input) : await client.createPlan(input));
      setSaved(true);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not save the plan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Field label="Key" error={errors.key} hint="Lower-case words joined by hyphens, e.g. team-annual.">
        {(id) => (
          <input
            id={id}
            value={draft.key}
            onChange={(event) => edit({ ...draft, key: event.target.value })}
            // Locked on edit: it is the primary key, and every subscription
            // ever written references it.
            disabled={editing}
            className={inputClass(Boolean(errors.key))}
          />
        )}
      </Field>

      <Field label="Label" error={errors.label} hint="What a person reads in a plan list.">
        {(id) => (
          <input
            id={id}
            value={draft.label}
            onChange={(event) => edit({ ...draft, label: event.target.value })}
            className={inputClass(Boolean(errors.label))}
          />
        )}
      </Field>

      <Field label="Icon" hint="The badge drawn beside the plan in the catalogue. Optional.">
        {(id) =>
          /*
           * The picker when the app has published what it can draw, a text box
           * otherwise — the same arrangement `RoleForm` uses, and the fallback
           * is not dead code: an app that never mounts `IconSetProvider` still
           * needs the field to work, and a free-text name is a worse experience
           * rather than a broken one.
           */
          iconSet ? (
            <IconPicker id={id} value={draft.icon} onChange={(name) => edit({ ...draft, icon: name })} />
          ) : (
            <input
              id={id}
              value={draft.icon}
              onChange={(event) => edit({ ...draft, icon: event.target.value })}
              className={inputClass(false)}
            />
          )
        }
      </Field>

      <div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.isPublic}
            onChange={(event) => edit({ ...draft, isPublic: event.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Offer this plan in the catalogue</span>
            {/*
              Says what unticking does NOT do. "Private" reads as "switched off"
              to most people, and the difference matters: archiving cuts
              entitlement off for live subscribers, this only stops new ones.
            */}
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Untick for a bespoke or grandfathered plan. It stays fully live for anyone already subscribed — that is
              archiving, which is a different switch.
            </span>
          </span>
        </label>
      </div>

      <section className="rounded-lg border border-border p-4">
        <div className="mb-3">
          <h2 className="text-sm font-medium">Limits</h2>
          <p className="text-xs text-muted-foreground">
            How many, as opposed to what. Checked when something is added, never when something is read — so a full
            organization is told to buy more rather than that access is denied.
          </p>
        </div>

        {errors.limits ? <p className="mb-2 text-sm text-destructive">{errors.limits}</p> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {PLAN_LIMITS.map((spec) => (
            <Field
              key={spec.key}
              label={spec.required ? `${spec.label} *` : spec.label}
              hint={
                spec.required
                  ? spec.description
                  : /*
                     * Says what leaving it blank MEANS, because the answer is
                     * not "unlimited". `resolveLimits` falls back to the
                     * registry floor, and somebody expecting no cap would find
                     * out at the first refused invitation.
                     */
                    `${spec.description} Blank means this plan does not set it — the floor of ${spec.defaultValue ?? 1} applies.`
              }
            >
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  step={1}
                  value={draft.limits[spec.key] ?? ''}
                  onChange={(event) =>
                    edit((current) => ({
                      ...current,
                      limits: { ...current.limits, [spec.key]: event.target.value },
                    }))
                  }
                  className={inputClass(false)}
                />
              )}
            </Field>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium">Features ({draft.features.length})</h2>
            <p className="text-xs text-muted-foreground">
              Organization- and workspace-level features only. App-level rights are exempt from entitlement, so a plan
              carrying one would sell nothing.
            </p>
          </div>
          {allPlans.length > 0 ? (
            <select
              value=""
              onChange={(event) => {
                const found = allPlans.find((candidate) => candidate.key === event.target.value);
                if (found) setCloneFrom(found);
              }}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Clone from…</option>
              {allPlans
                .filter((candidate) => candidate.key !== plan?.key)
                .map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {candidate.label} ({candidate.features.length})
                  </option>
                ))}
            </select>
          ) : null}
        </div>

        {errors.features ? <p className="mb-2 text-sm text-destructive">{errors.features}</p> : null}

        <TreeSelect
          nodes={tree}
          selected={draft.features}
          onChange={(features) => edit((current) => ({ ...current, features }))}
          searchPlaceholder="Search features…"
          emptyMessage="No organization- or workspace-level features are registered yet."
        />

        {skipped.length > 0 ? (
          <div className="mt-3 rounded-md bg-muted px-3 py-2 text-xs">
            <p className="font-medium">{skipped.length} not copied:</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {skipped.map((item) => (
                <li key={item.key}>
                  {item.key} — {SKIP_REASON[item.reason] ?? item.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {editing ? (
        /*
          Said BEFORE the save, not after. Updating a plan changes what every
          live subscriber is entitled to on their next request — which is the
          intended behaviour, and exactly the consequence somebody editing a
          label would not have thought about.
        */
        <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Saving changes what everyone already on this plan is entitled to, from their next request. A plan is the live
          definition of a product, not a snapshot taken at signup.
        </p>
      ) : null}

      {failure ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {failure}
        </p>
      ) : saved ? (
        // `role="status"`, not `alert`: announced without interrupting, which is
        // right for a confirmation and wrong for a failure.
        <p
          role="status"
          className="rounded-md bg-[var(--status-success)] px-3 py-2 text-sm text-[var(--status-success-foreground)]"
        >
          Saved.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Create plan'}
        </button>
        <a href={cancelHref} className="text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </a>
      </div>

      <ConfirmDialog
        open={cloneFrom !== null}
        title={`Clone ${cloneFrom?.label ?? ''}`}
        confirmLabel="Replace"
        alternative={{ label: 'Add to current', onSelect: () => void runClone('add') }}
        danger
        pending={cloneBusy}
        description={
          <>
            <strong>{cloneFrom?.label}</strong> sells {cloneFrom?.features.length ?? 0} feature
            {cloneFrom?.features.length === 1 ? '' : 's'}. Replace discards the {draft.features.length} currently
            selected; Add keeps them. Limits are not copied — they are what this plan charges for, and taking them from
            another plan is almost never what anybody means.
          </>
        }
        onConfirm={() => void runClone('replace')}
        onCancel={() => setCloneFrom(null)}
      />
    </div>
  );
}

const SKIP_REASON: Record<string, string> = {
  wrong_level: 'app level, so a plan cannot sell it',
  not_held: 'you do not hold it',
  unregistered: 'not in the registry',
};

function inputClass(invalid: boolean): string {
  return `w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60 ${
    invalid ? 'border-destructive' : 'border-border'
  }`;
}

/**
 * A labelled field.
 *
 * `children` is a FUNCTION of the generated id, not a node, so the label can be
 * associated with whatever control the caller renders — see the same helper in
 * role-form.tsx for why a wrapping `<label>` is not equivalent.
 */
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="mt-1 text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
