'use client';

import { ConfirmDialog, IconPicker, TreeSelect, type TreeSelectNode, useIconSet } from '@kwtech/web-ui/react';
import { useId, useMemo, useState } from 'react';
import { type RoleDraft, type RoleDraftErrors, validateRoleDraft } from '../../domain/role-draft.js';
import { canRoleGrant } from '../../domain/roles.js';
import { ROLE_LEVELS, type RoleLevel } from '../../types.js';
import type { FeatureView, PermissionsClient, RoleView } from '../permissions-client.js';
import { usePermissions } from '../use-permissions.js';

/** Features nobody filed under a tag. Sorted last, never hidden. */
const UNTAGGED = 'untagged';

/**
 * The one form behind both New and Edit.
 *
 * One component rather than two, for the reason `validateDraft` is one function:
 * two forms is two places for the field list to drift, and the drift shows up as
 * a field you can set when creating and not when editing.
 *
 * ## Two steps, not one
 *
 * Creating a role asks only what it IS — key, label, icon, level, organization.
 * Features are chosen afterwards, on the edit screen the save redirects to.
 *
 * That is not just pacing. Which features may be offered depends entirely on
 * the role's LEVEL: an organization role may only collect organization-level
 * keys, and app-level roles may collect anything. Picking features beside a
 * level selector means the list re-filters under the cursor every time the
 * level changes, and anything already ticked silently disappears. Fixing the
 * level first makes the choice stable and the filter explicable.
 *
 * ## What is locked on an edit
 *
 * `key` and `level`, both read by grants that already exist. Changing a level
 * silently re-interprets every grant made from the role — an organization role
 * becoming a workspace one stops applying organization-wide, with nothing
 * anywhere saying so, and every feature it carries may become one that level
 * cannot grant. The write path refuses both; this stops someone typing into a
 * field that would be ignored.
 */

/** Short form for prose, where LEVEL_LABEL's explanatory tail would not read. */
const LEVEL_NOUN: Record<RoleLevel, string> = {
  app: 'platform',
  organization: 'organization',
  workspace: 'workspace',
};

const LEVEL_LABEL: Record<RoleLevel, string> = {
  app: 'Platform — applies in every organization',
  organization: 'Organization — inside one organization',
  workspace: 'Workspace — inside one workspace',
};

export interface RoleFormProps {
  client: PermissionsClient;
  /** Absent for a new role. Present to edit one. */
  role?: RoleView;
  /** Every role, for the clone picker. */
  allRoles: readonly RoleView[];
  /**
   * Every grantable feature, fetched from the API.
   *
   * A PROP rather than an import, and that is the fix for a real bug: read from
   * this package's own `FEATURE_REGISTRY`, the list omitted every feature any
   * other module declared — so cloning a role that held `account:profile_write`
   * reported it "not in the registry" and silently dropped it, while the key
   * sat in `perm_feature`, undeprecated and granted. The server composes every
   * module's registry; this is that same list.
   */
  features: readonly FeatureView[];
  /**
   * Show everything, change nothing.
   *
   * For a role the write path will refuse — a system role, replaced by
   * `db:sync` on every deploy. The old behaviour was to render an explanation
   * INSTEAD of the role, which meant the one thing a reader wanted (what does
   * this role actually grant?) was the one thing they could not see. A refusal
   * that hides the answer teaches nothing.
   */
  readOnly?: boolean;
  onSaved: (role: RoleView) => void;
  cancelHref: string;
  /**
   * @deprecated Mount `<IconSetProvider>` instead — it reaches pages rendered
   * from a route descriptor, which cannot be handed props. Kept so a direct
   * importer that passed names still gets a working field.
   */
  iconOptions?: readonly string[];
}

export function RoleForm({
  client,
  role,
  allRoles,
  features,
  onSaved,
  cancelHref,
  iconOptions,
  readOnly = false,
}: RoleFormProps) {
  const context = usePermissions();
  // Null when the app has not said what it can draw — see the Icon field.
  const iconSet = useIconSet() ?? (iconOptions ? [] : null);
  const editing = role !== undefined;

  const [draft, setDraft] = useState<RoleDraft>({
    key: role?.key ?? '',
    label: role?.label ?? '',
    level: role?.level ?? 'organization',
    icon: role?.icon ?? '',
    features: role?.features ?? [],
  });
  const [errors, setErrors] = useState<RoleDraftErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /*
   * Cleared on the next edit, not on a timer.
   *
   * A confirmation that disappears by itself is one somebody can miss entirely
   * — and on this form the save is often one of several in a row, so "did that
   * one land" is a question being asked repeatedly. It goes when the answer
   * stops being true, which is the moment the draft changes again.
   */
  const [saved, setSaved] = useState(false);
  const [cloneFrom, setCloneFrom] = useState<RoleView | null>(null);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [skipped, setSkipped] = useState<{ key: string; reason: string }[]>([]);

  /*
   * `effective`, not `granted` — the same call FeaturesPage makes. What the
   * viewer can actually use here, after plan entitlement. It is also exactly
   * what the server's no-escalation check compares against, so the form offers
   * precisely what the write path will accept.
   */
  const held = useMemo(() => new Set(context?.effective ?? []), [context]);
  const level = draft.level as RoleLevel;

  /**
   * What this role may carry: registered, at a level it may grant, and held by
   * the person composing it.
   *
   * Filtered rather than shown-and-refused, so the form cannot offer a choice
   * the server will reject — the whole reason `validateRoleDraft` is shared.
   */
  const selectable = useMemo(
    () =>
      features
        .filter((spec) =>
          readOnly
            ? /*
               * READ-ONLY shows exactly what the role holds, and nothing else.
               *
               * NOT the editable filter. That one narrows to what the VIEWER
               * holds, which is right when choosing — you may not grant a right
               * you do not have — and wrong when looking: a role's own features
               * would vanish from the list simply because the reader lacks
               * them, so the page would under-report what it exists to show.
               */
              draft.features.includes(spec.key)
            : // Own level or narrower, and held by the author. `canRoleGrant` is
              // the same predicate the write path asserts, so the form cannot
              // offer a choice the server would refuse.
              canRoleGrant(level, spec.level as RoleLevel) && held.has(spec.key),
        )
        .slice()
        .sort((a, b) => a.key.localeCompare(b.key)),
    [features, level, held, readOnly, draft.features],
  );

  /** Every mutation of the draft goes through here, so `saved` cannot go stale. */
  const edit = (next: RoleDraft | ((current: RoleDraft) => RoleDraft)) => {
    setSaved(false);
    setDraft(next);
  };

  /**
   * The selectable features, nested by their TAG PATH.
   *
   * Tags read outermost-first — `['admin', 'roles']` is "the roles area of the
   * admin app" — so a path is a route through the tree rather than a set of
   * labels. `admin` contains `roles` contains the features themselves, and the
   * depth of the picker is whatever depth the registry declares. Nothing here
   * caps it at two.
   *
   * A feature appears ONCE, at the end of its path. That is the change from
   * treating tags as a set, where a feature carrying three tags showed up in
   * three places and every group's count double-counted it.
   *
   * Node ids are the accumulated path (`admin/roles/roles:read`) so two areas
   * may hold a feature of the same name without colliding, while the VALUE
   * stays the bare key — which is what the selection is actually made of.
   *
   * Untagged features get a group of their own, sorted last. A feature nobody
   * filed is still grantable, and hiding it would make it look absent.
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
      const preview = await client.previewClone({
        sourceRoleId: cloneFrom.id,
        current: draft.features,
        level: draft.level,
        mode,
      });
      edit((current) => ({ ...current, features: preview.features }));
      setSkipped(preview.skipped);
      setCloneFrom(null);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not clone that role.');
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
    const found = validateRoleDraft(draft, {
      // The same list the server validates against, so the form cannot refuse
      // something the API would accept, or offer something it would not.
      registry: features.map((feature) => ({ ...feature, level: feature.level as RoleLevel })),
      actorFeatures: context?.effective ?? [],
      ...(editing ? { originalKey: role.key } : {}),
    });
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setFailure(null);
    try {
      const input = {
        key: draft.key.trim(),
        label: draft.label.trim(),
        level: draft.level,
        icon: draft.icon.trim() || null,
        features: [...draft.features],
      };
      onSaved(editing ? await client.updateRole(role.id, input) : await client.createRole(input));
      setSaved(true);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not save the role.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Field label="Key" error={errors.key} hint="Lower-case words joined by hyphens, e.g. support-agent.">
        {(id) => (
          <input
            id={id}
            value={draft.key}
            onChange={(event) => edit({ ...draft, key: event.target.value })}
            // Locked on edit: grants already made name this key.
            disabled={editing || readOnly}
            className={inputClass(Boolean(errors.key))}
          />
        )}
      </Field>

      <Field label="Label" error={errors.label} hint="What a person reads in a role list.">
        {(id) => (
          <input
            id={id}
            value={draft.label}
            onChange={(event) => edit({ ...draft, label: event.target.value })}
            disabled={readOnly}
            className={inputClass(Boolean(errors.label))}
          />
        )}
      </Field>

      <Field label="Icon" hint="The badge drawn beside the role. Optional.">
        {(id) =>
          /*
           * The picker when the app has published what it can draw, a text box
           * otherwise. The module cannot enumerate icons itself — what `crown`
           * draws is the frontend's decision (see PermRole.icon), and a second
           * frontend has its own set.
           *
           * The fallback is not dead code: a consuming app that never mounts
           * `IconSetProvider` still needs the field to work, and a free-text
           * name is a worse experience rather than a broken one.
           */
          iconSet ? (
            <IconPicker id={id} value={draft.icon} onChange={(name) => edit({ ...draft, icon: name })} />
          ) : (
            <input
              id={id}
              value={draft.icon}
              onChange={(event) => edit({ ...draft, icon: event.target.value })}
              disabled={readOnly}
              className={inputClass(false)}
            />
          )
        }
      </Field>

      <Field label="Level" error={errors.level} hint="Where the role applies, and which features it may collect.">
        {(id) => (
          <select
            id={id}
            value={draft.level}
            onChange={(event) =>
              // Changing level re-filters what may be carried, so features the
              // new level cannot grant are dropped rather than left to fail
              // validation invisibly further down the page.
              edit((current) => ({ ...current, level: event.target.value, features: [] }))
            }
            disabled={editing || readOnly}
            className={inputClass(Boolean(errors.level))}
          >
            {ROLE_LEVELS.map((value) => (
              <option key={value} value={value}>
                {LEVEL_LABEL[value]}
              </option>
            ))}
          </select>
        )}
      </Field>

      {!editing ? (
        /*
         * Says what happens next, rather than leaving a form that looks like it
         * is missing half of itself. A create screen with no feature picker and
         * no explanation reads as broken.
         */
        <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Features are chosen next. Saving opens this role's editor, where the list is filtered to what a{' '}
          {LEVEL_NOUN[draft.level as RoleLevel] ?? draft.level}-level role may grant.
        </p>
      ) : (
        <section className="rounded-lg border border-border p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium">Features ({draft.features.length})</h2>
              <p className="text-xs text-muted-foreground">
                {readOnly
                  ? 'What this role grants. Everything else in the registry is hidden, as it is for editing.'
                  : 'Only features you hold yourself are listed — you cannot grant a right you do not have.'}
              </p>
            </div>
            {allRoles.length > 0 && !readOnly ? (
              <select
                value=""
                onChange={(event) => {
                  const found = allRoles.find((candidate) => candidate.id === event.target.value);
                  if (found) setCloneFrom(found);
                }}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Clone from…</option>
                {allRoles
                  .filter((candidate) => candidate.id !== role?.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label} ({candidate.features.length})
                    </option>
                  ))}
              </select>
            ) : null}
          </div>

          {errors.features ? <p className="mb-2 text-sm text-destructive">{errors.features}</p> : null}

          {/*
            A tag GROUP can be taken in one click, or a single feature on its
            own. Both matter: "everything under access-control" is how a role is
            usually described out loud, while the exceptions are always assigned
            one at a time.
          */}
          <TreeSelect
            nodes={tree}
            selected={draft.features}
            onChange={(features) => edit((current) => ({ ...current, features }))}
            disabled={readOnly}
            searchPlaceholder="Search features…"
            emptyMessage="No features are available at this level that you also hold."
          />

          {/*
          What a clone could NOT bring across. Shown rather than swallowed: a
          clone that granted less than the role it copied and said nothing would
          be discovered as a denial weeks later.
        */}
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
      )}

      {failure ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {failure}
        </p>
      ) : saved ? (
        // `role="status"`, not `alert`: a screen reader announces it without
        // interrupting, which is right for a confirmation and wrong for a failure.
        <p
          role="status"
          className="rounded-md bg-[var(--status-success)] px-3 py-2 text-sm text-[var(--status-success-foreground)]"
        >
          Saved.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        {readOnly ? null : (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create role'}
          </button>
        )}
        <a href={cancelHref} className="text-sm text-muted-foreground hover:text-foreground">
          {readOnly ? 'Back to roles' : 'Cancel'}
        </a>
      </div>

      <ConfirmDialog
        open={cloneFrom !== null}
        title={`Clone ${cloneFrom?.label ?? ''}`}
        confirmLabel="Replace"
        // Named for what happens to the features ALREADY selected — that is the
        // half at risk; the source's features arrive either way.
        alternative={{ label: 'Add to current', onSelect: () => void runClone('add') }}
        danger
        pending={cloneBusy}
        description={
          <>
            <strong>{cloneFrom?.label}</strong> carries {cloneFrom?.features.length ?? 0} feature
            {cloneFrom?.features.length === 1 ? '' : 's'}. Replace discards the {draft.features.length} currently
            selected; Add keeps them. Anything this role's level cannot grant, or that you do not hold, is skipped and
            listed.
          </>
        }
        onConfirm={() => void runClone('replace')}
        onCancel={() => setCloneFrom(null)}
      />
    </div>
  );
}

const SKIP_REASON: Record<string, string> = {
  wrong_level: 'not grantable at this role’s level',
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
 * associated with whatever control the caller renders. A bare `<label>` wrapped
 * around arbitrary children looks equivalent and is not: without `htmlFor` a
 * screen reader announces nothing when the field takes focus, and clicking the
 * label does not move the cursor into the input.
 *
 * `useId` rather than a counter or the field name — it is stable across the
 * server and client renders, which a counter is not, and two forms on one page
 * would otherwise mint the same id twice.
 */
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  // `| undefined` explicitly: exactOptionalPropertyTypes makes an explicit
  // undefined a different thing from an absent key, and these are forwarded
  // straight from an error map that legitimately holds undefined.
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
      {/* The error REPLACES the hint rather than stacking under it: two lines of
          guidance under one field is where the eye stops reading either. */}
      {error ? (
        <p className="mt-1 text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
