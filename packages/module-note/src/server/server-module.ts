import type { ServerModuleDescriptor } from '@kwtech/module-kit';
import { NOTE_FEATURE_REGISTRY, NOTE_LIMIT_REGISTRY } from '../feature-keys.js';
import { NoteModule } from './note.module.js';
import type { NoteModuleOptions } from './note.options.js';

/**
 * Notes as DATA the host composes: listed in `SERVER_MODULES`, and its
 * resolver, keys and cap arrive with it.
 *
 * ⚠ The keys and cap must ALSO be composed in the app's `seed/registry.ts`.
 * An uncomposed registry means the bindings never load — every note operation
 * reachable by anybody signed in — and the cap is never mirrored for plans.
 */
export function noteServerModule(options: NoteModuleOptions = {}): ServerModuleDescriptor {
  return {
    key: 'note',
    nestModule: NoteModule.forRoot(options),
    features: NOTE_FEATURE_REGISTRY,
    limits: NOTE_LIMIT_REGISTRY,
  };
}
