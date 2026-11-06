import { BACKUP_FEATURE } from '../src/feature-keys.js';
import { BACKUPS_ADMIN_HREF, backupWebModule, SERVER_NAV_GROUP } from '../src/react/module.js';

describe('the backup web module', () => {
  it('puts Backups in the Server section, behind backup:read', () => {
    const module = backupWebModule();
    const [route] = module.routes ?? [];
    expect(route?.path).toBe(BACKUPS_ADMIN_HREF);
    expect(route?.feature).toBe(BACKUP_FEATURE.read);
    expect(route?.nav?.group).toBe(SERVER_NAV_GROUP);
    expect(module.navGroups).toEqual([{ group: SERVER_NAV_GROUP, order: 60 }]);
  });

  it("names its section 'Server', the string module-local-network declares too", () => {
    // Pinned as a literal: the two modules cannot share a constant (they never
    // import each other), so a rename here must be made there as well, or the
    // drawer shows two Server sections.
    expect(SERVER_NAV_GROUP).toBe('Server');
  });
});
