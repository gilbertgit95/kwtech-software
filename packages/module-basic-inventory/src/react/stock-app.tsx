'use client';

import type { AppProps } from '@kwtech/module-kit';
import { useHoldsFeature } from '@kwtech/module-kit/react';
import { Boxes, ClipboardList, type LucideIcon, Shapes, Tags } from 'lucide-react';
import { useCallback, useState } from 'react';
import { STOCK_FEATURE } from '../feature-keys.js';
import { CategoriesSection } from './components/categories-section.js';
import { Alert, Empty, SectionBar } from './components/layout.js';
import { ProductsSection } from './components/products-section.js';
import { StockSection } from './components/stock-section.js';
import { TakesSection } from './components/takes-section.js';
import type { StockClient } from './stock-client.js';
import { useStockContext, useStockData } from './use-stock.js';
import { needsAttention } from './view/lists.js';

type Section = 'stock' | 'products' | 'takes' | 'categories';

/**
 * Stock as a SUB-APP on the workspace's Apps page (docs/INVENTORY-PLAN.md).
 *
 * - Laid out by the BOX's width, never the viewport's (`@container`), because a
 *   grid cell is narrow on a wide screen.
 * - Which section is open is this component's own state, never a URL: a link
 *   would leave the Apps page and close every other app running on it.
 * - Controls show only to somebody holding their key; hiding is cosmetic — the
 *   API refuses too. Staff (`stock:receive`) record what happens at the counter;
 *   what is counted and how a sale takes it is `stock:manage`'s.
 * - The overview — every item, category and list line — is read ONCE here and
 *   handed to every section, so a count on one tab never disagrees with
 *   another's; a sale at the till, a delivery, anything, reloads it
 *   (`stockEvents`).
 */
export function StockApp({ organizationId, workspaceId, client }: AppProps & { client?: StockClient }) {
  const stock = useStockContext(organizationId, workspaceId, client ? { client } : {});
  const canReceive = useHoldsFeature(STOCK_FEATURE.receive);
  const canManage = useHoldsFeature(STOCK_FEATURE.manage);
  const load = useCallback(() => stock.client.overview(stock.scope), [stock.client, stock.scope]);
  const overview = useStockData(stock.scope, load, 'Could not load the stock.');
  const [section, setSection] = useState<Section>('stock');
  const reload = () => void overview.reload();
  const view = overview.data;

  const sections: { key: Section; label: string; icon: LucideIcon; badge?: number }[] = [
    { key: 'stock', label: 'Stock', icon: Boxes, badge: view ? needsAttention(view.items) : 0 },
    { key: 'products', label: 'Products', icon: Shapes },
    ...(canManage
      ? [
          { key: 'takes' as const, label: 'Stock takes', icon: ClipboardList },
          { key: 'categories' as const, label: 'Categories', icon: Tags },
        ]
      : []),
  ];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the handler only catches Esc bubbling up from a section, to return to the stock list; every control inside has its own keys.
    <div
      className="@container flex h-full min-h-0 w-full flex-col gap-3 p-3 text-foreground"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || section === 'stock' || event.defaultPrevented) return;
        // ⚠ Esc inside a dialog closes the dialog, never the section under it.
        if (event.target instanceof Element && event.target.closest('dialog')) return;
        setSection('stock');
      }}
    >
      <SectionBar label="Stock" sections={sections} current={section} onChange={setSection}>
        {!stock.live ? 'Not live — sales and other people’s changes show when you reload.' : null}
      </SectionBar>

      <Alert message={overview.error} />
      {view === null ? (
        <Empty>{overview.loading ? 'Loading the stock…' : 'The stock could not be opened.'}</Empty>
      ) : (
        <>
          {section === 'stock' ? (
            <StockSection
              stock={stock}
              overview={view}
              canReceive={canReceive}
              canManage={canManage}
              onChanged={reload}
              onOpenProducts={() => setSection('products')}
            />
          ) : null}
          {section === 'products' ? (
            <ProductsSection
              stock={stock}
              overview={view}
              canReceive={canReceive}
              canManage={canManage}
              onChanged={reload}
            />
          ) : null}
          {section === 'takes' && canManage ? <TakesSection stock={stock} overview={view} onChanged={reload} /> : null}
          {section === 'categories' && canManage ? (
            <CategoriesSection stock={stock} overview={view} onChanged={reload} />
          ) : null}
        </>
      )}
    </div>
  );
}
