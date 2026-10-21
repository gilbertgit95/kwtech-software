import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { STOCK_FEATURE, STOCK_FEATURE_REGISTRY, STOCK_LIMIT_REGISTRY } from '../feature-keys.js';
import { StockApp } from './stock-app.js';

/**
 * Stock's web descriptor — its app and its keys, as data the web app composes:
 *
 *   const FEATURE_MODULES = [..., stockWebModule()];
 *
 * A function, as `booksWebModule` is, so options can arrive without changing
 * the call site.
 *
 * ⚠ NO ROUTES and NO DRAWER ENTRY. A sub-app is reached from the workspace's
 * Apps page.
 */
export function stockWebModule(): WebModuleDescriptor {
  return {
    key: 'stock',
    features: STOCK_FEATURE_REGISTRY,
    limits: STOCK_LIMIT_REGISTRY,
    apps: [
      {
        // ⚠ Saved in people's layouts. Never rename it.
        key: 'stock',
        label: 'Stock',
        description: 'What is on the shelf, what each product uses up, deliveries, waste and stock takes.',
        icon: 'boxes',
        feature: STOCK_FEATURE.read,
        // Between the point of sale (40), which it counts for, and the books (50).
        order: 45,
        component: StockApp,
      },
    ],
  };
}
