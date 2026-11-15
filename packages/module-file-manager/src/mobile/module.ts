import type { MobileModuleDescriptor } from '@kwtech/module-kit';
import { FILE_FEATURE } from '../feature-keys.js';
import { FilesMobileApp } from './files-mobile-app.js';

/**
 * What files offer the phone layout (issues #22, #142): `FilesMobileApp`, a
 * screen of its own over the same `useFiles` as the Apps page — cards, filter
 * chips, a round ＋ that opens the upload as a bottom sheet, and a sheet of
 * actions per file. A phone's picker is where many uploads start.
 *
 * Gated by `file:read`, the key that offers it on the Apps page.
 */
export function fileMobileModule(): MobileModuleDescriptor {
  return {
    key: 'file',
    screens: [
      { key: 'file', label: 'Files', icon: 'folder', feature: FILE_FEATURE.read, order: 80, component: FilesMobileApp },
    ],
  };
}
