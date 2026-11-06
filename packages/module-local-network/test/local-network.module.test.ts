import { LOCAL_NETWORK_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { LocalNetworkModule } from '../src/server/local-network.module.js';
import { localNetworkServerModule } from '../src/server/server-module.js';

describe('LocalNetworkModule', () => {
  it('⚠ registers nothing while off, which is the default', () => {
    for (const options of [undefined, {}, { enabled: false }]) {
      const module = LocalNetworkModule.forRoot(options);
      expect(module.providers).toBeUndefined();
      expect(module.exports).toBeUndefined();
    }
  });

  it('⚠ checks nothing while off: a remote server has no certificate to point at', () => {
    expect(() => LocalNetworkModule.forRoot({ enabled: false })).not.toThrow();
  });

  it('registers the service and the resolver while on', () => {
    const module = LocalNetworkModule.forRoot({
      enabled: true,
      certificatePath: '/x/root.crt',
      origin: { ok: true, host: '192.168.1.68' },
    });
    expect(module.providers).toHaveLength(3);
  });

  it('⚠ keeps its key in the descriptor while off, so db:sync never deprecates it', () => {
    expect(localNetworkServerModule().features).toBe(LOCAL_NETWORK_FEATURE_REGISTRY);
  });
});
