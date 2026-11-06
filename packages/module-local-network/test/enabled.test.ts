import { localNetworkIsEnabled } from '../src/enabled.js';

describe('localNetworkIsEnabled', () => {
  it('⚠ is OFF unless told otherwise: a remote server never sets it', () => {
    expect(localNetworkIsEnabled()).toBe(false);
    expect(localNetworkIsEnabled({})).toBe(false);
    expect(localNetworkIsEnabled({ enabled: undefined })).toBe(false);
    expect(localNetworkIsEnabled({ enabled: false })).toBe(false);
  });

  it('is on only for exactly true', () => {
    expect(localNetworkIsEnabled({ enabled: true })).toBe(true);
    // A value that slipped past the app's env parsing is still off, never "truthy, so on".
    const loose = { enabled: 'on' } as unknown as { enabled?: boolean };
    expect(localNetworkIsEnabled(loose)).toBe(false);
  });
});
