import { createLocalNetworkClient } from '../src/react/local-network-client.js';
import type { LocalNetworkView } from '../src/types.js';

const READY: LocalNetworkView = {
  state: 'ready',
  problem: null,
  appUrl: 'https://192.168.1.68',
  certificateUrl: 'http://192.168.1.68/kwtech-local-ca.crt',
  certificate: { pem: 'PEM', sha256: 'AA', sha1: 'BB', subject: 'CN=x', expiresAt: '2036-01-01T00:00:00.000Z' },
};

function answer(status: number, body: unknown): void {
  globalThis.fetch = jest.fn(async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('createLocalNetworkClient', () => {
  it('returns the view', async () => {
    answer(200, { data: { localNetwork: READY } });
    expect(await createLocalNetworkClient().view()).toEqual({ kind: 'view', view: READY });
  });

  it('⚠ reads the 400 that means the API’s switch is off, rather than "Cannot reach the server"', async () => {
    answer(400, { errors: [{ message: 'Cannot query field "localNetwork" on type "Query".' }] });
    expect(await createLocalNetworkClient().view()).toEqual({ kind: 'api_off' });
  });

  it('shows the API’s own refusal', async () => {
    answer(200, { errors: [{ message: 'Your role does not include this.' }], data: null });
    await expect(createLocalNetworkClient().view()).rejects.toThrow('Your role does not include this.');
  });

  it('says the session ended on a 401, and the server is unreachable on another failure', async () => {
    answer(401, {});
    await expect(createLocalNetworkClient().view()).rejects.toThrow('Your session has ended. Sign in again.');
    globalThis.fetch = jest.fn(async () => new Response('Bad gateway', { status: 502 })) as typeof fetch;
    await expect(createLocalNetworkClient().view()).rejects.toThrow('Cannot reach the server.');
  });
});
