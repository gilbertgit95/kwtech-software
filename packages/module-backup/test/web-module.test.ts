import { BACKUP_FEATURE } from '../src/feature-keys.js';
import { BACKUPS_ADMIN_HREF, backupWebModule, DATABASE_NAV_GROUP } from '../src/react/module.js';

describe('the backup web module', () => {
  it('puts Backups in a Database section of its own, behind backup:read', () => {
    const module = backupWebModule();
    const [route] = module.routes ?? [];
    expect(route?.path).toBe(BACKUPS_ADMIN_HREF);
    expect(route?.feature).toBe(BACKUP_FEATURE.read);
    expect(route?.nav?.group).toBe(DATABASE_NAV_GROUP);
    expect(module.navGroups).toEqual([{ group: DATABASE_NAV_GROUP, order: 60 }]);
  });
});
