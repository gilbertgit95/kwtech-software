import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { BOOKS_FEATURE, BOOKS_FEATURE_REGISTRY } from '../feature-keys.js';
import { BooksApp } from './books-app.js';

/**
 * The books' web descriptor — its app and its keys, as data the web app composes:
 *
 *   const FEATURE_MODULES = [..., booksWebModule()];
 *
 * A function, as `posWebModule` is, so options can arrive without changing the
 * call site.
 *
 * ⚠ NO ROUTES and NO DRAWER ENTRY. A sub-app is reached from the workspace's
 * Apps page.
 */
export function booksWebModule(): WebModuleDescriptor {
  return {
    key: 'books',
    features: BOOKS_FEATURE_REGISTRY,
    apps: [
      {
        // ⚠ Saved in people's layouts. Never rename it.
        key: 'books',
        label: 'Books',
        description: 'Cash on hand, investors, profit shares and loans.',
        icon: 'wallet',
        feature: BOOKS_FEATURE.read,
        // After the queue (10), notes (20), tasks (30) and the point of sale (40).
        order: 50,
        component: BooksApp,
      },
    ],
  };
}
