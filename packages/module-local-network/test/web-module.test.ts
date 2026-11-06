import { LOCAL_NETWORK_FEATURE, LOCAL_NETWORK_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { LOCAL_NETWORK_ADMIN_HREF, localNetworkWebModule, SERVER_NAV_GROUP } from '../src/react/module.js';

describe('the local network web module', () => {
  it('⚠ contributes no page and no drawer entry while off, which is the default', () => {
    for (const options of [undefined, {}, { enabled: false }]) {
      const module = localNetworkWebModule(options);
      expect(module.routes ?? []).toEqual([]);
      expect(module.navGroups ?? []).toEqual([]);
    }
  });

  it('⚠ keeps its key while off, so db:sync never deprecates it', () => {
    expect(localNetworkWebModule().features).toBe(LOCAL_NETWORK_FEATURE_REGISTRY);
  });

  it('puts the page in the Server section after Backups, behind local_network:read, while on', () => {
    const module = localNetworkWebModule({ enabled: true });
    const [route] = module.routes ?? [];
    expect(route?.path).toBe(LOCAL_NETWORK_ADMIN_HREF);
    expect(route?.feature).toBe(LOCAL_NETWORK_FEATURE.read);
    expect(route?.nav).toEqual({ group: SERVER_NAV_GROUP, order: 20, icon: 'globe' });
    expect(module.navGroups).toEqual([{ group: SERVER_NAV_GROUP, order: 60 }]);
  });

  it("names its section 'Server', the string module-backup declares too", () => {
    // Pinned as a literal: the two modules cannot share a constant, so a rename
    // in one must be made in the other, or the drawer shows two Server sections.
    expect(SERVER_NAV_GROUP).toBe('Server');
  });
});
