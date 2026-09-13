import { parseTrustProxy } from '../src/config/trust-proxy.js';

/**
 * `TRUST_PROXY` decides whose word the API takes for a client's address, which
 * is what every per-IP rate limit is keyed on (PLAN §12.69). Getting it too
 * loose is worse than leaving it off, so the parse is pinned.
 */
describe('parseTrustProxy', () => {
  it.each([[undefined], [''], ['  '], ['false'], ['off'], ['none'], ['0']])('trusts nobody for %j', (raw) => {
    expect(parseTrustProxy(raw)).toBe(false);
  });

  it('reads a hop count', () => {
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('reads a list of addresses, subnets and presets', () => {
    expect(parseTrustProxy('loopback, 10.0.0.0/8 ,')).toEqual(['loopback', '10.0.0.0/8']);
  });

  it('⚠ refuses to trust every hop, which believes any client that forges its address', () => {
    expect(() => parseTrustProxy('true')).toThrow(/trust every hop/);
    expect(() => parseTrustProxy('TRUE')).toThrow(/trust every hop/);
  });
});
