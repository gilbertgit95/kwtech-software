import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * `deploy/https/origin.cjs`, the one copy of the whole-origin rule: read by
 * the pm2 launcher and `pnpm env:check` before anything is built, and by this
 * app at boot for module-local-network (docs/LOCAL-NETWORK-PLAN.md §4). Tested
 * here because this is the one package with a test runner that reads it.
 */
type OriginCheck = { ok: true; host: string } | { ok: false; problem: string };
const { checkLocalOrigin, meantForLocalNetwork } = createRequire(__filename)(
  join(__dirname, '..', '..', '..', 'deploy', 'https', 'origin.cjs'),
) as { checkLocalOrigin: (url: unknown) => OriginCheck; meantForLocalNetwork: (url: unknown) => boolean };

describe('checkLocalOrigin', () => {
  it.each(['https://192.168.1.68', 'https://10.0.0.5', 'https://172.16.0.1', 'https://172.31.255.254'])(
    'accepts %s',
    (url) => {
      expect(checkLocalOrigin(url)).toEqual({ ok: true, host: new URL(url).hostname });
    },
  );

  it.each([
    ['https://192.168.1.68:8443', 'it has a port; Caddy listens on 443 only'],
    ['https://192.168.1.68:443', 'write it exactly as https://192.168.1.68'],
    ['https://user:pw@192.168.1.68', 'it has a user name or password'],
    ['https://192.168.1.68/app', 'it has a path'],
    ['https://192.168.1.68/?a=1', 'it has a query'],
    ['https://192.168.1.68?a=1', 'it has a query'],
    ['https://192.168.1.68#x', 'it has a fragment'],
    ['https://192.168.1.68/', 'write it exactly as https://192.168.1.68'],
    ['HTTPS://192.168.1.68', 'write it exactly as https://192.168.1.68'],
    ['https://0300.0250.1.68', 'write it exactly as https://192.168.1.68'],
    ['http://192.168.1.68', 'it is not https://'],
    ['https://pos.example.com', 'its host is not a private IPv4 address (10.x, 172.16–31.x or 192.168.x)'],
    ['https://8.8.8.8', 'its host is not a private IPv4 address (10.x, 172.16–31.x or 192.168.x)'],
    ['https://172.32.0.1', 'its host is not a private IPv4 address (10.x, 172.16–31.x or 192.168.x)'],
    ['https://localhost', 'its host is not a private IPv4 address (10.x, 172.16–31.x or 192.168.x)'],
    ['https://:443', 'it is not a valid address'],
    ['', 'it is empty'],
    [undefined, 'it is empty'],
  ])('⚠ refuses %s: %s', (url, problem) => {
    expect(checkLocalOrigin(url)).toEqual({ ok: false, problem });
  });
});

describe('meantForLocalNetwork', () => {
  it('is true for https:// on a private address, or an https:// address that does not parse', () => {
    expect(meantForLocalNetwork('https://192.168.1.68:8443')).toBe(true);
    expect(meantForLocalNetwork('https://:443')).toBe(true);
  });

  it('is false for a domain and for http://, which start as they always have', () => {
    expect(meantForLocalNetwork('https://pos.example.com')).toBe(false);
    expect(meantForLocalNetwork('http://localhost:8081')).toBe(false);
    expect(meantForLocalNetwork(undefined)).toBe(false);
  });
});
