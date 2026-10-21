'use client';

import { useState } from 'react';
import type { StockCategoryView, StockOverviewView } from '../../views.js';
import { type StockContext, useStockAction } from '../use-stock.js';
import { buttonClass } from './controls.js';
import { CategoryDialog } from './dialogs.js';
import { Alert, Empty, StatusChip } from './layout.js';

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

  const setArchived = async (category: StockCategoryView, archived: boolean) => {
    const done = await action.run(
      () => stock.client.setCategoryArchived(stock.scope, category.id, archived),
      'Could not change the category.',
    );
    if (done) onChanged();
  };

  return (
    <section className="flex min-h-0 flex-col gap-3">
      <div>
        <button type="button" className={buttonClass('primary', 'sm')} onClick={() => setEditing('new')}>
          New category
        </button>
      </div>
      <Alert message={action.error} onDismiss={action.dismissError} />
      {overview.categories.length === 0 ? <Empty>No categories yet.</Empty> : null}
      <ul className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
        {overview.categories.map((category) => (
          <li
            key={category.id}
            className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{category.name}</span>
              <span className="text-xs text-muted-foreground">{count(category.id)} item(s)</span>
              {category.archivedAt ? <StatusChip label="Archived" tone="neutral" /> : null}
            </span>
            <span className="flex shrink-0 gap-1">
              <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setEditing(category)}>
                Rename
              </button>
              <button
                type="button"
                className={buttonClass('ghost', 'sm')}
                disabled={action.busy}
                onClick={() => void setArchived(category, category.archivedAt === null)}
              >
                {category.archivedAt ? 'Restore' : 'Archive'}
              </button>
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
