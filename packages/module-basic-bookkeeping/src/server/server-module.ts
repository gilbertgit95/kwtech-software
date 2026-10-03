import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { BOOKS_FEATURE_REGISTRY } from '../feature-keys.js';
import { BooksModule } from './books.module.js';
import type { BooksModuleOptions } from './books.options.js';

/**
 * The books as DATA the host composes: listed in `SERVER_MODULES`, and its
 * resolvers and keys arrive with it.
 *
 * ⚠ The keys must ALSO be composed in the app's `seed/registry.ts`. An
 * uncomposed registry means the bindings never load — every bookkeeping
 * operation reachable by anybody signed in.
 */
export function booksServerModule(options: BooksModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'books',
    nestModule: BooksModule.forRoot(options),
    features: BOOKS_FEATURE_REGISTRY,
  };
}
