'use client';

import { Archive, ArchiveRestore, Pencil, Plus, Tag } from 'lucide-react';
import { useState } from 'react';
import type { StockCategoryView, StockOverviewView } from '../../views.js';
import { type StockContext, useStockAction } from '../use-stock.js';
import { plural } from '../view/lists.js';
import { buttonClass, IconButton } from './controls.js';
import { CategoryDialog } from './dialogs.js';
import { Alert, EmptyState, StatusChip } from './layout.js';

/**
 * Categories group the stock list and a stock take's sheet ("count the paper
 * today"). Archiving one keeps its items; they only stop being offered it.
 */
export function CategoriesSection({
  stock,
  overview,
  onChanged,
}: {
  stock: StockContext;
  overview: StockOverviewView;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<StockCategoryView | 'new' | null>(null);
  const action = useStockAction();
  const count = (id: string) => overview.items.filter((item) => item.categoryId === id && !item.archivedAt).length;
  const uncategorised = overview.items.filter((item) => !item.archivedAt && item.categoryId === null).length;
  // Live first, then archived; each by its order, then name.
  const categories = [...overview.categories].sort(
    (a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null) || a.sortOrder - b.sortOrder,
  );

  const setArchived = async (category: StockCategoryView, archived: boolean) => {
    const done = await action.run(
      () => stock.client.setCategoryArchived(stock.scope, category.id, archived),
      'Could not change the category.',
    );
    if (done) onChanged();
  };

  return (
    <section className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Group items to filter the list and to count one shelf at a time.
          {uncategorised > 0 ? ` ${plural(uncategorised, 'item')} ${uncategorised === 1 ? 'has' : 'have'} none.` : ''}
        </p>
        <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" className="size-3.5" />
          New category
        </button>
      </div>
      <Alert message={action.error} onDismiss={action.dismissError} />
      {categories.length === 0 ? (
        <EmptyState icon={Tag} title="No categories yet">
          Try “Boards”, “Paper and film”, “Mugs and blanks” — whatever matches how your shelves are laid out.
        </EmptyState>
      ) : null}
      <ul className="grid min-h-0 grid-cols-1 content-start gap-2 overflow-y-auto pb-2 @xl:grid-cols-2 @4xl:grid-cols-3">
        {categories.map((category) => (
          <li
            key={category.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shadow-xs"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Tag aria-hidden="true" className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium">{category.name}</span>
              <span className="text-xs text-muted-foreground">{plural(count(category.id), 'item')}</span>
            </span>
            {category.archivedAt ? <StatusChip label="Archived" tone="neutral" /> : null}
            <span className="flex shrink-0">
              <IconButton label={`Rename ${category.name}`} onClick={() => setEditing(category)}>
                <Pencil aria-hidden="true" className="size-4" />
              </IconButton>
              <IconButton
                label={category.archivedAt ? `Restore ${category.name}` : `Archive ${category.name}`}
                disabled={action.busy}
                onClick={() => void setArchived(category, category.archivedAt === null)}
              >
                {category.archivedAt ? (
                  <ArchiveRestore aria-hidden="true" className="size-4" />
                ) : (
                  <Archive aria-hidden="true" className="size-4" />
                )}
              </IconButton>
            </span>
          </li>
        ))}
      </ul>
      <CategoryDialog
        open={editing !== null}
        category={editing === 'new' ? null : editing}
        stock={stock}
        onClose={() => setEditing(null)}
        onDone={onChanged}
      />
    </section>
  );
}
