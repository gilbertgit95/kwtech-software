'use client';

import { ChevronRight, Search } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { cn } from './utils.js';

/**
 * A grouped, expandable multi-select.
 *
 * Built for picking a handful of things out of a long, categorised list — the
 * role editor's feature assignment is the first caller, but nothing here knows
 * about features. It takes a tree of nodes and a set of chosen VALUES.
 *
 * ## One leaf may appear in several groups
 *
 * Deliberate, and the reason selection is keyed by `value` rather than by
 * position. A feature can carry several tags, so it belongs under each of them;
 * ticking it anywhere ticks it everywhere, because the same value is selected
 * either way. A tree that forced one home per leaf would have to invent a
 * primary tag, which is exactly the hierarchy tags exist to avoid.
 *
 * ## Group checkboxes are tri-state
 *
 * Checked when every selectable descendant is chosen, INDETERMINATE when some
 * are. Without the middle state a half-selected group reads as empty, and the
 * obvious repair — clicking it — silently selects everything underneath.
 */

export interface TreeSelectNode {
  /** Unique within the tree. For a leaf this is also the selected value unless `value` is given. */
  id: string;
  label: string;
  /** A second line under the label — a key, a description. */
  hint?: string;
  /** Present makes this a GROUP; absent makes it a leaf. */
  children?: readonly TreeSelectNode[];
  /** The value a leaf contributes. Defaults to `id`. */
  value?: string;
}

export interface TreeSelectProps {
  nodes: readonly TreeSelectNode[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
  /** Omit to hide the search box entirely. */
  searchPlaceholder?: string;
  /** Groups start open. Off by default: a collapsed tree shows the shape first. */
  defaultExpanded?: boolean;
  emptyMessage?: ReactNode;
  /**
   * Checkboxes become non-interactive; expanding still works.
   *
   * Deliberately not "hide the tree": a read-only viewer is here to SEE what is
   * selected, so the branches must still open. Only the act of changing it goes
   * away.
   */
  disabled?: boolean;
  className?: string;
}

/** Every value under a node, including the node itself when it is a leaf. */
function valuesOf(node: TreeSelectNode): string[] {
  if (!node.children) return [node.value ?? node.id];
  return node.children.flatMap(valuesOf);
}

function matches(node: TreeSelectNode, term: string): boolean {
  if (`${node.label} ${node.hint ?? ''} ${node.value ?? node.id}`.toLowerCase().includes(term)) return true;
  return (node.children ?? []).some((child) => matches(child, term));
}

export function TreeSelect({
  nodes,
  selected,
  onChange,
  searchPlaceholder,
  defaultExpanded = false,
  emptyMessage = 'Nothing to choose from.',
  disabled = false,
  className,
}: TreeSelectProps) {
  const [query, setQuery] = useState('');
  const chosen = useMemo(() => new Set(selected), [selected]);
  const term = query.trim().toLowerCase();

  const visible = useMemo(() => (term ? nodes.filter((node) => matches(node, term)) : nodes), [nodes, term]);

  const setValues = useCallback(
    (values: readonly string[], on: boolean) => {
      const next = new Set(chosen);
      for (const value of values) {
        if (on) next.add(value);
        else next.delete(value);
      }
      // Sorted, so the caller's state does not reorder between renders and a
      // dirty check can compare two lists directly.
      onChange([...next].sort());
    },
    [chosen, onChange],
  );

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {searchPlaceholder ? (
        <div className="relative">
          <Search aria-hidden className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-sm"
          />
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-muted-foreground">
          {term ? `Nothing matches “${query}”.` : emptyMessage}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {visible.map((node) => (
            <Branch
              key={node.id}
              node={node}
              chosen={chosen}
              term={term}
              defaultOpen={defaultExpanded}
              disabled={disabled}
              onSet={setValues}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One node, at any depth.
 *
 * Each branch owns its OWN open state rather than the tree holding a map of
 * them. With a single level a map was equivalent; nested, it is not — the
 * recursion would have to thread a path-keyed setter through every level, and
 * the version that did not simply passed `open` as a constant, which silently
 * made every sub-group permanently expanded.
 */
function Branch({
  node,
  chosen,
  term,
  defaultOpen,
  disabled,
  onSet,
}: {
  node: TreeSelectNode;
  chosen: ReadonlySet<string>;
  term: string;
  defaultOpen: boolean;
  disabled: boolean;
  onSet: (values: readonly string[], on: boolean) => void;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  /*
   * Searching forces every surviving branch open — a match three levels down is
   * useless if its ancestors are shut. A manual toggle still wins while it
   * lasts, so opening a group to look inside does not fight the filter.
   */
  const open = manual ?? (term ? true : defaultOpen);
  const values = useMemo(() => valuesOf(node), [node]);
  const picked = values.filter((value) => chosen.has(value)).length;
  const all = picked === values.length && values.length > 0;
  const some = picked > 0 && !all;

  if (!node.children) {
    const value = node.value ?? node.id;
    return (
      <li>
        <label
          className={cn(
            'flex items-start gap-2 rounded-md px-2 py-1.5',
            disabled ? 'cursor-default' : 'cursor-pointer hover:bg-accent/50',
          )}
        >
          <input
            type="checkbox"
            checked={chosen.has(value)}
            disabled={disabled}
            onChange={(event) => onSet([value], event.target.checked)}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-sm">{node.label}</span>
            {node.hint ? <span className="block text-xs text-muted-foreground">{node.hint}</span> : null}
          </span>
        </label>
      </li>
    );
  }

  const children = term ? node.children.filter((child) => matches(child, term)) : node.children;

  return (
    <li>
      <div className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-accent/40">
        {/*
          Expand and select are SEPARATE controls. One control doing both means
          you cannot look inside a group without changing what is selected —
          and on a tri-state checkbox that is a destructive accident.
        */}
        <button
          type="button"
          onClick={() => setManual(!open)}
          aria-expanded={open}
          aria-label={open ? `Collapse ${node.label}` : `Expand ${node.label}`}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronRight aria-hidden className={cn('size-4 transition-transform', open && 'rotate-90')} />
        </button>

        <label className="flex flex-1 cursor-pointer items-center gap-2 py-0.5">
          <input
            type="checkbox"
            checked={all}
            /*
             * `indeterminate` is a PROPERTY, not an attribute — there is no
             * `indeterminate=""` in HTML, so React cannot set it declaratively
             * and a ref is the only way. Without it a half-chosen group renders
             * as empty.
             */
            ref={(input) => {
              if (input) input.indeterminate = some;
            }}
            disabled={disabled}
            onChange={(event) => onSet(values, event.target.checked)}
          />
          <span className="flex-1 text-sm font-medium">{node.label}</span>
          {/* The count is what makes a collapsed group readable: "2 / 7" says
              the group is partly chosen without expanding it. */}
          <span className="text-xs tabular-nums text-muted-foreground">
            {picked} / {values.length}
          </span>
        </label>
      </div>

      {open ? (
        <ul className="ml-5 border-l border-border pl-2">
          {children.map((child) => (
            <Branch
              key={child.id}
              node={child}
              chosen={chosen}
              term={term}
              // A sub-group starts open once its parent has been opened: the
              // click that revealed it was a request to see inside, not to meet
              // another closed door.
              defaultOpen
              disabled={disabled}
              onSet={onSet}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
