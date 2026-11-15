'use client';

import { cn } from '@kwtech/web-ui/react';
import { FolderOpen, Search, SearchX } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { emptyListWords, FILE_FILTERS, type FileFilter } from '../view/files-view.js';

/**
 * Search, and All · Mine · Shared with me as chips with their counts. The
 * chips scroll sideways in a narrow box rather than wrap, so the list starts
 * at the same height on every phone.
 */
export function FileToolbar({
  search,
  onSearch,
  filter,
  onFilter,
  counts,
}: {
  search: string;
  onSearch: (search: string) => void;
  filter: FileFilter;
  onFilter: (filter: FileFilter) => void;
  counts: Record<FileFilter, number>;
}) {
  const searchId = useId();
  return (
    <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center">
      <div className="relative min-w-0 flex-1 @2xl:max-w-sm">
        <label htmlFor={searchId} className="sr-only">
          Search files
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search by name or person"
          className="min-h-11 w-full rounded-2xl border border-border/70 bg-card pr-3 pl-10 text-base text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @2xl:min-h-10 @2xl:text-sm"
        />
      </div>
      <div
        role="tablist"
        aria-label="Show"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] @2xl:mx-0 @2xl:px-0"
      >
        {FILE_FILTERS.map((choice) => {
          const selected = choice.value === filter;
          return (
            <button
              key={choice.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onFilter(choice.value)}
              className={cn(
                'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:bg-accent',
              )}
            >
              {choice.label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  selected ? 'bg-primary-foreground/20' : 'bg-background/70',
                )}
              >
                {counts[choice.value]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Nothing to show, said plainly, with the one thing to do next. */
export function FileEmpty({
  searching,
  canWrite,
  filter,
  action,
}: {
  searching: boolean;
  canWrite: boolean;
  filter: FileFilter;
  action?: ReactNode;
}) {
  const { title, detail } = emptyListWords(filter, searching, canWrite);
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      <span aria-hidden className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
        {searching ? <SearchX className="size-7" /> : <FolderOpen className="size-7" />}
      </span>
      <div>
        <p className="text-base font-semibold">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{detail}</p>
      </div>
      {action && !searching ? action : null}
    </div>
  );
}

/** Rows that look like the list, while it loads. */
export function FileSkeleton() {
  return (
    <ul aria-hidden className="flex flex-col gap-2">
      {['a', 'b', 'c'].map((key) => (
        <li key={key} className="flex items-center gap-3 rounded-2xl border border-border/50 p-3">
          <span className="size-10 animate-pulse rounded-xl bg-muted" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            <span className="h-2.5 w-1/3 animate-pulse rounded bg-muted" />
          </span>
        </li>
      ))}
    </ul>
  );
}
