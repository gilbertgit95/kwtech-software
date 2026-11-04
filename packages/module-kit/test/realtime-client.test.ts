import { createRealtimeConnection } from '../src/realtime-client.js';

describe('createRealtimeConnection — an address that cannot be one', () => {
  it('⚠ reports it through onError and never throws: a page must not go down over realtime', () => {
    const errors: string[] = [];
    const open = () =>
      createRealtimeConnection({
        wsUrl: 'https://192.168.1.68/api/v1/graphql',
        onError: (error) => errors.push(error.message),
      });
    expect(open).not.toThrow();
    expect(errors).toEqual([
      'The realtime address "https://192.168.1.68/api/v1/graphql" is neither a path (/api/v1/graphql) nor a ws:// or wss:// address. Fix NEXT_PUBLIC_WS_URL and rebuild the web app.',
    ]);
  });

  it('⚠ says refused, never idle — a till must not look live with no socket (#50)', () => {
    const connection = createRealtimeConnection({ wsUrl: 'not-an-address' });
    expect(connection.status?.().status).toBe('refused');
  });

  it('accepts subscribers and closes without doing anything', () => {
    // A path with no page to resolve it against, as on a server render.
    const connection = createRealtimeConnection({ wsUrl: '/api/v1/graphql' });
    const heard: unknown[] = [];
    const unsubscribe = connection.subscribe('subscription { x }', (data) => heard.push(data));
    expect(() => {
      unsubscribe();
      connection.onStatus?.(() => undefined)();
      connection.reconnectNow?.();
      connection.close();
    }).not.toThrow();
    expect(heard).toEqual([]);
  });
});
