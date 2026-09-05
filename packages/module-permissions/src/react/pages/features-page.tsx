'use client';

import { ConfirmDialog, DataGrid, type DataGridColumn, MultiSelect, useDebouncedValue } from '@kwtech/web-ui/react';
import { useCallback, useMemo, useState } from 'react';
import { type FeatureFilter, featureFacets, filterFeatures, isEmptyFilter } from '../../domain/feature-filter.js';
import { FEATURE, FEATURE_REGISTRY } from '../../feature-keys.js';
import { tagsInUse } from '../../feature-tags.js';
import type { RoleLevel } from '../../types.js';
import { FeatureGate } from '../feature-gate.js';
import { usePermissions } from '../use-permissions.js';
import { AdminPage } from './admin-page.js';

/**
 * The grantable vocabulary — every key a role can contain, where it is
 * enforced, and which of them the viewer holds.
 *
 * ## Why this one has a real screen and its siblings do not
 *
 * `FEATURE_REGISTRY` is a constant compiled into this package. The list is
 * already here, so the page needs no query, no resolver and no loading state —
 * unlike Organizations and Subscriptions, whose rows live in tables no API
 * exposes yet.
 *
 * ## Read-only, permanently
 *
 * The registry is the source and the database is the mirror; `syncFeatureRegistry`
 * upserts it and deprecates what is gone. Editing a feature here would make the
 * mirror disagree with the source until the next deploy overwrote it — so this
 * page shows what exists and the code stays the only way to change it.
 *
 * ## The grid
 *
 * `<DataGrid>` from `@kwtech/web-ui`, never `ag-grid-react` directly (PLAN §8).
 * Nine rows do not need a data grid, but the columns, the search and the theme
 * bridge are the same ones the role editor and the organization list will want,
 * and proving them on a page whose data cannot fail is cheaper than proving them
 * on one that can.
 */

/** One row, flattened — a grid sorts and filters over scalars, not nested shapes. */
interface FeatureRow {
  key: string;
  label: string;
  description: string;
  module: string;
  level: RoleLevel;
  isPrivileged: boolean;
  /** Joined, so the quick filter matches a binding identifier by substring. */
  bindings: string;
  /** The list, for the chips; `tagText` is what the quick filter searches. */
  tags: readonly string[];
  tagText: string;
  bindingCount: number;
  held: boolean;
}

/**
 * Sort order for the level column: by BLAST RADIUS, not alphabetically.
 *
 * Alphabetically it would read app, organization, workspace — which puts
 * platform rights first and looks like a hierarchy running the wrong way.
 */
const LEVEL_RANK: Record<RoleLevel, number> = { workspace: 0, organization: 1, app: 2 };

const LEVEL_LABEL: Record<RoleLevel, string> = {
  workspace: 'Workspace',
  organization: 'Organization',
  app: 'Platform',
};

export function FeaturesPage() {
  const context = usePermissions();

  /*
   * `effective` and not `granted`: what the viewer can actually use here, after
   * plan entitlement has been applied. `granted` is what their roles say in
   * isolation, and showing that would tick features their organization has not
   * bought — the exact confusion `entitled` exists to prevent.
   */
  const held = useMemo(() => new Set(context?.effective ?? []), [context]);

  const [selected, setSelected] = useState<FeatureRow[]>([]);
  const [confirming, setConfirming] = useState(false);
  /**
   * ONE filter object, shaped exactly like the API's `FeatureFilterInput`.
   *
   * Not five pieces of state: the whole thing is what gets sent when this list
   * comes from a query rather than a constant, and assembling it at the call
   * site is where a facet gets forgotten.
   */
  const [filter, setFilter] = useState<FeatureFilter>({});

  /**
   * The search box is CONTROLLED by the raw value and the FILTER uses the
   * debounced one — so typing feels immediate while the query waits for a
   * pause. Binding the input itself to the debounced value is the classic
   * version of this bug: characters appear a beat after they are typed.
   */
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText, 250);

  /*
   * Stable, so the grid does not see a new callback on every render and tear
   * down its selection listener with it.
   */
  const onSelectionChange = useCallback((rows: FeatureRow[]) => setSelected(rows), []);
  const getRowId = useCallback((row: FeatureRow) => row.key, []);

  /*
   * Double-click opens the editor.
   *
   * `encodeURIComponent` is not optional here: every key contains a colon, and
   * an unencoded one in a path segment is at best ambiguous and at worst read as
   * a scheme separator. `matchRouteWithParams` decodes it back on the way in,
   * which is asserted in module-kit's tests.
   *
   * A full navigation rather than a router push — this package must not depend
   * on Next, which is why the toolbar links are plain anchors too.
   */
  const onRowActivate = useCallback((row: FeatureRow) => {
    window.location.assign(`/admin/features/${encodeURIComponent(row.key)}/edit`);
  }, []);

  const rows = useMemo<FeatureRow[]>(
    () =>
      FEATURE_REGISTRY.map((spec) => ({
        key: spec.key,
        label: spec.label,
        description: spec.description,
        module: spec.module,
        level: spec.level,
        isPrivileged: spec.isPrivileged ?? false,
        bindings: (spec.bindings ?? []).map((binding) => binding.identifier).join(' · '),
        bindingCount: (spec.bindings ?? []).length,
        tags: spec.tags ?? [],
        tagText: (spec.tags ?? []).join(' '),
        held: held.has(spec.key),
      })),
    [held],
  );

  /**
   * The SAME `filterFeatures` the API applies, over the same registry.
   *
   * The page reads a compiled constant rather than fetching, so there is no
   * query here to push a WHERE clause into — but the SEMANTICS are the query's,
   * not a second implementation. When this list becomes database-backed, the
   * page swaps a constant for a fetch and every rule already matches, because
   * it is literally the same function.
   */
  const effectiveFilter = useMemo<FeatureFilter>(
    () => ({ ...filter, search: debouncedSearch }),
    [filter, debouncedSearch],
  );

  const matching = useMemo(() => filterFeatures(FEATURE_REGISTRY, effectiveFilter), [effectiveFilter]);
  const visible = useMemo(() => rows.filter((row) => matching.some((spec) => spec.key === row.key)), [rows, matching]);

  /* Built from the data, so a module or level nobody uses never becomes an empty option. */
  const facets = useMemo(() => featureFacets(FEATURE_REGISTRY), []);
  const availableTags = useMemo(() => tagsInUse(FEATURE_REGISTRY), []);

  /** Toggling one value inside a multi-select facet. */
  const toggleIn = useCallback((field: 'modules' | 'levels' | 'tags', value: string) => {
    setFilter((current) => {
      const chosen = new Set(current[field] ?? []);
      if (!chosen.delete(value)) chosen.add(value);
      return { ...current, [field]: chosen.size > 0 ? [...chosen] : undefined };
    });
  }, []);

  const clearFacet = useCallback((field: 'modules' | 'levels' | 'tags') => {
    setFilter((current) => ({ ...current, [field]: undefined }));
  }, []);

  const clearAll = useCallback(() => {
    setFilter({});
    setSearchText('');
  }, []);

  // The RAW text, not the debounced one: a pending keystroke still counts as
  // filtering, or Clear would vanish for a quarter-second mid-type.
  const filtering = !isEmptyFilter({ ...filter, search: searchText });

  return (
    <AdminPage
      title="Features"
      description="Every right a role can grant, and where each one is enforced. Defined in code and mirrored into the database on deploy — this page is read-only."
      feature={FEATURE.featuresRead}
      // A data screen: full width, and the grid takes the height the heading
      // leaves. Nine rows do not need it — the role editor and the organization
      // list will.
      layout="fill"
    >
      {/*
        A column, because the body is no longer a single full-height child: the
        filter bar takes what it needs and the grid takes the rest. Without it
        the grid's `h-full` would claim the whole body and push the bar out.
      */}
      <div className="flex h-full min-h-0 flex-col gap-3">
        <FilterBar
          search={searchText}
          onSearch={setSearchText}
          filter={filter}
          setFilter={setFilter}
          facets={facets}
          tags={availableTags}
          onToggle={toggleIn}
          onClearFacet={clearFacet}
          onClear={clearAll}
          filtering={filtering}
          showing={visible.length}
          total={rows.length}
        />

        <DataGrid<FeatureRow>
          rows={visible}
          columns={COLUMNS}
          height="fill"
          onSelectionChange={onSelectionChange}
          /*
           * The key, not the row index. Without it AG Grid identifies rows by
           * position, so sorting or filtering slides the selection onto whatever
           * now sits there — and a delete confirmed on three rows removes three
           * different ones.
           */
          getRowId={getRowId}
          onRowActivate={onRowActivate}
          toolbar={
            /*
            Each control carries its OWN key, so the toolbar reflects what the
            reader can actually do rather than offering three buttons that
            refuse. These are the `ui_component` bindings the registry declares
            — `FeaturesPage.EditButton` and friends — and this is where they are
            enforced.

            Not a security boundary: hiding a button hides an affordance, not an
            endpoint. Every request is still authorised at the API.
          */
            <>
              <FeatureGate allOf={[FEATURE.featuresUpdate]}>
                {/*
              Edit is a VISIBLE control as well as a double-click. The
              double-click is unfindable on its own and impossible on a
              touchscreen, so it is a shortcut to this, not a replacement for it.
            */}
                <button
                  type="button"
                  onClick={() => {
                    const row = selected[0];
                    if (row) onRowActivate(row);
                  }}
                  disabled={selected.length !== 1}
                  title={selected.length > 1 ? 'Select one feature to edit' : undefined}
                  className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  Edit
                </button>
              </FeatureGate>
              {/*
              Create and import are SEPARATE gates, not one. Adding a feature by
              hand and bulk-loading a hundred from a file are the same act at
              very different scale, and scale is the reason someone might be
              trusted with one and not the other.
            */}
              <FeatureGate allOf={[FEATURE.featuresCreate]}>
                <ToolbarLink href="/admin/features/new/manual">New</ToolbarLink>
              </FeatureGate>
              <FeatureGate allOf={[FEATURE.featuresImport]}>
                <ToolbarLink href="/admin/features/new/import">Import</ToolbarLink>
              </FeatureGate>
              <FeatureGate allOf={[FEATURE.featuresDelete]}>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  // Disabled rather than hidden: a button that vanishes when nothing
                  // is selected leaves no clue that selecting a row is what enables
                  // it, and the toolbar reflows every time a checkbox is ticked.
                  disabled={selected.length === 0}
                  className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  Delete{selected.length > 0 ? ` (${selected.length})` : ''}
                </button>
              </FeatureGate>
            </>
          }
        />
      </div>

      <ConfirmDialog
        open={confirming}
        title={selected.length === 1 ? 'Delete this feature?' : `Delete ${selected.length} features?`}
        /*
         * The dialog says what deleting actually MEANS here, because it is not
         * what someone expects. A feature is a compiled constant; removing the
         * row without removing the registry entry achieves nothing, since the
         * next sync writes it straight back.
         */
        description={
          <>
            <p>
              {selected.length === 1 ? 'This feature is ' : 'These features are '}defined in code, in{' '}
              <code className="font-mono text-xs">FEATURE_REGISTRY</code>. Deleting the database row does not remove{' '}
              {selected.length === 1 ? 'it' : 'them'} — the next <code className="font-mono text-xs">pnpm db:sync</code>{' '}
              writes {selected.length === 1 ? 'it' : 'them'} back.
            </p>
            <ul className="mt-2 flex flex-col gap-0.5">
              {selected.map((row) => (
                <li key={row.key} className="font-mono text-xs">
                  {row.key}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              To retire {selected.length === 1 ? 'it' : 'them'} for good, remove the{' '}
              {selected.length === 1 ? 'entry' : 'entries'} from the registry and run{' '}
              <code className="font-mono text-xs">pnpm db:sync</code>, which deprecates rather than deletes so existing
              grants and audit history stay readable.
            </p>
          </>
        }
        confirmLabel={selected.length === 1 ? 'Delete anyway' : `Delete ${selected.length} anyway`}
        onCancel={() => setConfirming(false)}
        onConfirm={() => setConfirming(false)}
      />
    </AdminPage>
  );
}

/**
 * A link styled as a toolbar button.
 *
 * A plain `<a>`, not next/link: this package must not depend on Next — it is
 * imported by a NestJS app too, and `next` is only an optional peer of
 * module-auth for its route handlers. A full navigation to an admin page costs
 * nothing anyone will notice.
 */
function ToolbarLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
    >
      {children}
    </a>
  );
}

const COLUMNS: readonly DataGridColumn<FeatureRow>[] = [
  {
    field: 'label',
    headerName: 'Feature',
    flex: 2,
    minWidth: 220,
    /*
     * The description is in the same cell rather than a column of its own.
     * Given its own column it would either be clipped — a truncated description
     * reads as a complete short one — or set the row height for every other
     * column. Under the label it wraps naturally and the row grows once.
     */
    cellRenderer: ({ data }: { data?: FeatureRow }) =>
      data ? (
        <div className="py-1.5 leading-snug">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{data.label}</span>
            {/*
              Flagged in the list, not only in the editor. "Irreversible or
              heavily audited" is the one property someone scanning this page
              needs to notice without reading every description.
            */}
            {data.isPrivileged ? (
              <span className="rounded border border-status-warning-foreground/30 bg-status-warning px-1.5 py-0.5 text-[0.6875rem] font-medium text-status-warning-foreground">
                Privileged
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-muted-foreground">{data.description}</p>
        </div>
      ) : null,
    /*
     * The description is folded into the SEARCHABLE value even though the
     * renderer draws it separately. AG Grid's quick filter reads cell values,
     * not rendered DOM, so without this "reproducing what they see" would match
     * nothing despite being on screen.
     */
    valueGetter: ({ data }) => (data ? `${data.label} ${data.description}` : ''),
  },
  {
    field: 'key',
    headerName: 'Key',
    minWidth: 190,
    cellRenderer: ({ value }: { value?: string }) => (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{value}</code>
    ),
  },
  {
    field: 'level',
    headerName: 'Level',
    minWidth: 130,
    valueFormatter: ({ value }) => LEVEL_LABEL[value as RoleLevel] ?? String(value),
    // Sorts by blast radius via LEVEL_RANK rather than by the displayed string.
    comparator: (a: RoleLevel, b: RoleLevel) => LEVEL_RANK[a] - LEVEL_RANK[b],
  },
  { field: 'module', headerName: 'Module', minWidth: 120 },
  {
    field: 'bindings',
    headerName: 'Enforced at',
    flex: 2,
    minWidth: 220,
    cellRenderer: ({ data }: { data?: FeatureRow }) =>
      data?.bindingCount === 0 ? (
        /*
          Called out rather than left blank. A key with no bindings guards
          nothing while reading as coverage in the role editor — see
          FeatureSurface. An empty cell would hide exactly that.
        */
        <span className="text-status-warning-foreground">Not enforced anywhere</span>
      ) : (
        <span className="font-mono text-xs text-muted-foreground">{data?.bindings}</span>
      ),
  },
  {
    field: 'tagText',
    headerName: 'Tags',
    minWidth: 170,
    /*
     * Sorted and filtered on the joined TEXT, rendered as chips. AG Grid sorts
     * and quick-filters over cell values, and an array cell would compare as
     * "[object Object]" — which sorts consistently and means nothing.
     */
    cellRenderer: ({ data }: { data?: FeatureRow }) => (
      <div className="flex flex-wrap gap-1 py-1.5">
        {(data?.tags ?? []).map((tag) => (
          <span
            key={tag}
            className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground"
          >
            {tag}
          </span>
        ))}
      </div>
    ),
  },
  {
    field: 'held',
    headerName: 'You',
    minWidth: 100,
    maxWidth: 120,
    flex: 0,
    // 'Held'/'—' rather than true/false: the filter menu then offers words
    // someone can recognise instead of checkboxes labelled with booleans.
    valueFormatter: ({ value }) => (value ? 'Held' : '—'),
    cellClass: ({ value }) => (value ? 'text-status-success-foreground' : 'text-muted-foreground'),
  },
];

/**
 * The filter bar: search, then facets, then a count.
 *
 * Everything is visible rather than behind a "Filters" button. The whole
 * vocabulary fits on two rows, and hiding facets hides the very thing they
 * exist to reveal — someone who does not know a `module` facet exists will
 * never open a panel to look for it.
 *
 * ## Two rules, and they are not a style choice
 *
 *   module, level   ANY of the chosen. A feature has exactly one of each, so
 *                   requiring all would always match nothing.
 *   tags            ALL of the chosen. A feature has many, so intersecting is
 *                   meaningful and each chip narrows.
 *
 * The same rules the API applies, because both call `filterFeatures`.
 */
function FilterBar({
  search,
  onSearch,
  filter,
  setFilter,
  facets,
  tags,
  onToggle,
  onClearFacet,
  onClear,
  filtering,
  showing,
  total,
}: {
  search: string;
  onSearch: (value: string) => void;
  filter: FeatureFilter;
  setFilter: (update: (current: FeatureFilter) => FeatureFilter) => void;
  facets: { modules: string[]; levels: string[] };
  tags: readonly string[];
  onToggle: (field: 'modules' | 'levels' | 'tags', value: string) => void;
  onClearFacet: (field: 'modules' | 'levels' | 'tags') => void;
  onClear: () => void;
  filtering: boolean;
  showing: number;
  total: number;
}) {
  /*
   * ONE ROW. The facets used to sit on a second line, which read as two
   * unrelated bars — a search above and "some other controls" below — and cost
   * a row of vertical space the grid wanted. Everything that narrows the list
   * belongs together, in the order it narrows: text, then the facets, then the
   * two switches.
   *
   * `flex-wrap`, so a narrow window folds it rather than clipping it, and the
   * status is pushed right with `ml-auto` so the count sits at the edge instead
   * of drifting after whichever control happens to be last.
   */
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Search keys, labels, descriptions, tags, bindings…"
        aria-label="Search features"
        className="w-full max-w-sm rounded-md border border-input bg-transparent px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      />
      <MultiSelect
        label="Module"
        hint="Any of the chosen — a feature has exactly one."
        options={facets.modules}
        selected={filter.modules ?? []}
        onToggle={(value) => onToggle('modules', value)}
        onClear={() => onClearFacet('modules')}
      />
      <MultiSelect
        label="Level"
        hint="Any of the chosen."
        options={facets.levels}
        selected={filter.levels ?? []}
        onToggle={(value) => onToggle('levels', value)}
        onClear={() => onClearFacet('levels')}
      />
      <MultiSelect
        label="Tags"
        // The rule that differs, said where someone can see it: tags are
        // many-per-feature, so each one added narrows rather than widens.
        hint="All of the chosen — each one narrows."
        options={tags}
        selected={filter.tags ?? []}
        onToggle={(value) => onToggle('tags', value)}
        onClear={() => onClearFacet('tags')}
      />
      <Toggle
        label="Privileged only"
        on={filter.isPrivileged === true}
        onChange={(on) => setFilter((current) => ({ ...current, isPrivileged: on ? true : undefined }))}
      />
      {/*
          The most useful audit question this list can answer, and impossible to
          ask by eye once the registry is long: which keys read as coverage in a
          role editor while guarding nothing?
        */}
      <Toggle
        label="Not enforced"
        on={filter.unboundOnly === true}
        onChange={(on) => setFilter((current) => ({ ...current, unboundOnly: on ? true : undefined }))}
      />

      <div className="ml-auto flex items-center gap-2">
        {filtering ? (
          <>
            <button
              type="button"
              onClick={onClear}
              className="rounded-full px-2 py-1 text-xs font-medium text-muted-foreground underline transition-colors hover:text-foreground"
            >
              Clear
            </button>
            {/*
                Only while filtering. A permanent "17 of 17" is noise that trains
                the eye to skip the line, and then the day it says "0 of 17"
                nobody reads it.
              */}
            <span className="text-xs text-muted-foreground" role="status">
              {showing} of {total}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** A two-state chip, for the filters that are simply on or off. */
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={
        on
          ? 'rounded-full border border-primary bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors'
          : 'rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
      }
    >
      {label}
    </button>
  );
}
