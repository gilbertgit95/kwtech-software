import type { MobileModuleDescriptor } from '@kwtech/module-kit';
import { NOTE_FEATURE } from '../feature-keys.js';
import { NotesMobileApp } from './notes-mobile-app.js';

/**
 * What notes offer the phone layout (issue #22): `NotesMobileApp`, notes laid
 * out for a phone — a list, then one note full screen — on the same hooks as
 * the Apps page's `NoteApp`. The desktop app squeezed into a phone was a poor
 * fit for a thumb (the operator, 2026-10-29).
 *
 * Gated by `note:read`, the key that offers it on the Apps page.
 */
export function noteMobileModule(): MobileModuleDescriptor {
  return {
    key: 'note',
    screens: [
      { key: 'note', label: 'Notes', icon: 'pen', feature: NOTE_FEATURE.read, order: 20, component: NotesMobileApp },
    ],
  };
}
