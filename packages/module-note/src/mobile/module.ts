import type { MobileModuleDescriptor } from '@kwtech/module-kit';
import { NOTE_FEATURE } from '../feature-keys.js';
import { NoteApp } from '../react/note-app.js';

/**
 * What notes offer the phone layout (issue #22): the same app as the Apps
 * page's, full screen. `NoteApp` is a sub-app, built to work in a box of any
 * size by its container's width — a phone is a narrow box — and never to
 * navigate, which is what a phone screen must not do either.
 *
 * Gated by `note:read`, the key that offers it on the Apps page.
 */
export function noteMobileModule(): MobileModuleDescriptor {
  return {
    key: 'note',
    screens: [{ key: 'note', label: 'Notes', icon: 'pen', feature: NOTE_FEATURE.read, order: 20, component: NoteApp }],
  };
}
