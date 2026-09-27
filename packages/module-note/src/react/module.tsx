import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { NOTE_FEATURE, NOTE_FEATURE_REGISTRY } from '../feature-keys.js';
import { NoteApp } from './note-app.js';

/**
 * The notes web descriptor — its app and its key, as data the web app composes:
 *
 *   const FEATURE_MODULES = [..., noteWebModule()];
 *
 * A function, as `queueWebModule` is, so options can arrive without changing
 * the call site.
 *
 * ⚠ NO ROUTES and NO DRAWER ENTRY. A sub-app is reached from the workspace's
 * Apps page. A full-page route for direct links (a notification, a bookmark)
 * comes with the real screens, as the queue's console route did.
 */
export function noteWebModule(): WebModuleDescriptor {
  return {
    key: 'note',
    features: NOTE_FEATURE_REGISTRY,
    apps: [
      {
        // ⚠ Saved in people's layouts. Never rename it.
        key: 'note',
        label: 'Notes',
        description: 'Write and keep notes for this workspace.',
        icon: 'pen',
        feature: NOTE_FEATURE.read,
        // After the queue (10).
        order: 20,
        component: NoteApp,
      },
    ],
  };
}
