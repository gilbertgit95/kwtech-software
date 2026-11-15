import type { MobileModuleDescriptor } from '@kwtech/module-kit';
import { FILE_FEATURE } from '../feature-keys.js';
import { FileApp } from '../react/file-app.js';

/**
 * What files offer the phone layout (issue #22): the same `FileApp` as the
 * Apps page. It is already laid out by its box (`@container`), so on a phone
 * it is one column, and a phone's file picker is where most uploads start.
 *
 * Gated by `file:read`, the key that offers it on the Apps page.
 */
export function fileMobileModule(): MobileModuleDescriptor {
  return {
    key: 'file',
    screens: [
      { key: 'file', label: 'Files', icon: 'folder', feature: FILE_FEATURE.read, order: 80, component: FileApp },
    ],
  };
}
