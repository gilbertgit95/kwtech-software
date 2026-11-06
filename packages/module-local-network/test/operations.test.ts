import { LOCAL_NETWORK_OPERATIONS } from '../src/operations.js';

describe('the page’s query', () => {
  it('reads the state, the addresses and every certificate detail, and changes nothing', () => {
    const query = LOCAL_NETWORK_OPERATIONS.localNetwork;
    expect(query.startsWith('query LocalNetwork')).toBe(true);
    for (const field of [
      'state',
      'problem',
      'appUrl',
      'certificateUrl',
      'pem',
      'sha256',
      'sha1',
      'subject',
      'expiresAt',
    ]) {
      expect(query).toMatch(new RegExp(`\\b${field}\\b`, 'u'));
    }
    expect(Object.values(LOCAL_NETWORK_OPERATIONS).some((document) => document.includes('mutation'))).toBe(false);
  });
});
