import {
  closeEvent,
  describeRealtimeError,
  isRealtimeLive,
  MAX_RECONNECT_DELAY_MS,
  nextRealtimeStatus,
  REALTIME_REFUSED_CODE,
  realtimeLiveChangeIn,
  reconnectDelay,
  resolveSocketUrl,
} from '../src/realtime.js';

describe('reconnectDelay — for a screen nobody is watching', () => {
  const noJitter = () => 0;

  it('backs off exponentially from one second', () => {
    expect([0, 1, 2, 3].map((retries) => reconnectDelay(retries, noJitter))).toEqual([1000, 2000, 4000, 8000]);
  });

  it('⚠ never waits longer than the cap, however long the outage', () => {
    expect(reconnectDelay(4, noJitter)).toBe(MAX_RECONNECT_DELAY_MS);
    expect(reconnectDelay(400, noJitter)).toBe(MAX_RECONNECT_DELAY_MS);
  });

  it('adds up to a second of jitter, so a room of TVs does not reconnect in one stampede', () => {
    expect(reconnectDelay(0, () => 0.999)).toBe(1999);
  });
});

describe('nextRealtimeStatus — what a screen is told about the socket', () => {
  it('reports a first attempt as connecting, and any later one as reconnecting', () => {
    expect(nextRealtimeStatus('idle', 'connecting')).toBe('connecting');
    expect(nextRealtimeStatus('live', 'connecting')).toBe('reconnecting');
    expect(nextRealtimeStatus('reconnecting', 'connecting')).toBe('reconnecting');
  });

  it('is live once acknowledged, whatever came before', () => {
    expect(nextRealtimeStatus('connecting', 'connected')).toBe('live');
    expect(nextRealtimeStatus('reconnecting', 'connected')).toBe('live');
  });

  it('treats a lost socket as reconnecting, never as idle', () => {
    expect(nextRealtimeStatus('live', 'closed')).toBe('reconnecting');
  });

  it('⚠ treats the lazy close (1000, nothing subscribed) as idle, not as a loss', () => {
    expect(nextRealtimeStatus('live', 'closed_normally')).toBe('idle');
  });

  it('⚠ keeps a refusal final: a later close does not turn it back into a retry', () => {
    expect(nextRealtimeStatus('live', 'refused')).toBe('refused');
    expect(nextRealtimeStatus('refused', 'closed')).toBe('refused');
    expect(nextRealtimeStatus('refused', 'closed_normally')).toBe('refused');
  });
});

describe('closeEvent — reading a close code', () => {
  it('maps 4403 to a refusal, 1000 to a normal close, and anything else to a loss', () => {
    expect(closeEvent(REALTIME_REFUSED_CODE)).toBe('refused');
    expect(closeEvent(1000)).toBe('closed_normally');
    expect(closeEvent(4499)).toBe('closed');
    expect(closeEvent(undefined)).toBe('closed');
  });
});

describe('resolveSocketUrl — the socket goes where the page came from (issue #50)', () => {
  const lan = { protocol: 'https:', host: '192.168.1.68' };
  const thisPc = { protocol: 'https:', host: 'localhost' };

  it('⚠ sends the same build to whichever address the page was opened on', () => {
    expect(resolveSocketUrl('/api/v1/graphql', lan)).toBe('wss://192.168.1.68/api/v1/graphql');
    expect(resolveSocketUrl('/api/v1/graphql', thisPc)).toBe('wss://localhost/api/v1/graphql');
  });

  it('follows the page’s scheme and keeps its port', () => {
    expect(resolveSocketUrl('/api/v1/graphql', { protocol: 'http:', host: 'localhost:8081' })).toBe(
      'ws://localhost:8081/api/v1/graphql',
    );
  });

  it('leaves a full address alone: a socket on another host is the app’s decision', () => {
    expect(resolveSocketUrl('wss://pos.example.com/api/v1/graphql', thisPc)).toBe(
      'wss://pos.example.com/api/v1/graphql',
    );
    expect(resolveSocketUrl('ws://localhost:8080/api/v1/graphql', null)).toBe('ws://localhost:8080/api/v1/graphql');
  });

  it('makes nothing up: no page for a path, a protocol-relative or an http address', () => {
    expect(resolveSocketUrl('/api/v1/graphql', null)).toBeNull();
    expect(resolveSocketUrl('//elsewhere.example/api/v1/graphql', lan)).toBeNull();
    expect(resolveSocketUrl('https://192.168.1.68/api/v1/graphql', lan)).toBeNull();
    expect(resolveSocketUrl('', lan)).toBeNull();
  });
});

describe('describeRealtimeError — a sentence, never "[object Event]"', () => {
  const url = 'wss://192.168.1.68/api/v1/graphql';

  it('says which address could not be reached, for the browser’s bare Event', () => {
    expect(describeRealtimeError({ type: 'error' }, url).message).toBe(
      'Could not reach the live-updates socket at wss://192.168.1.68/api/v1/graphql. Screens update only on a reload until it connects.',
    );
  });

  it('gives the close code of a CloseEvent', () => {
    expect(describeRealtimeError({ type: 'close', code: 1006 }, url).message).toBe(
      'The live-updates socket to wss://192.168.1.68/api/v1/graphql closed (code 1006).',
    );
  });

  it('lists the messages of a refused subscription', () => {
    expect(describeRealtimeError([{ message: 'Not signed in' }, { message: 'Forbidden' }], url).message).toBe(
      'A live subscription was refused: Not signed in; Forbidden',
    );
  });

  it('passes an Error through untouched', () => {
    const error = new Error('Could not authorize the realtime connection.');
    expect(describeRealtimeError(error, url)).toBe(error);
  });
});

describe('isRealtimeLive — the socket’s state, not "the app has a connection" (#50, #64)', () => {
  const SINCE = 1_000_000;
  const AFTER = 5_000;

  it('⚠ is not live with a connection that never connects, once the attempt has run past the threshold', () => {
    // The POS cashier's till in #50: a connection object, and a socket timing out behind it.
    expect(isRealtimeLive(true, 'connecting', SINCE, SINCE + AFTER, AFTER)).toBe(false);
    expect(isRealtimeLive(true, 'reconnecting', SINCE, SINCE + 60_000, AFTER)).toBe(false);
  });

  it('stays live through a routine reconnect', () => {
    expect(isRealtimeLive(true, 'reconnecting', SINCE, SINCE + AFTER - 1, AFTER)).toBe(true);
    expect(isRealtimeLive(true, 'connecting', SINCE, SINCE, AFTER)).toBe(true);
  });

  it('follows each screen’s own threshold', () => {
    expect(isRealtimeLive(true, 'reconnecting', SINCE, SINCE + 8_000, 5_000)).toBe(false);
    expect(isRealtimeLive(true, 'reconnecting', SINCE, SINCE + 8_000, 10_000)).toBe(true);
  });

  it('is not live at once when refused, nor with no connection at all', () => {
    expect(isRealtimeLive(true, 'refused', SINCE, SINCE, AFTER)).toBe(false);
    expect(isRealtimeLive(false, null, SINCE, SINCE, AFTER)).toBe(false);
  });

  it('is live when connected or idle, and for a connection that reports no status', () => {
    expect(isRealtimeLive(true, 'live', SINCE, SINCE + 600_000, AFTER)).toBe(true);
    expect(isRealtimeLive(true, 'idle', SINCE, SINCE, AFTER)).toBe(true);
    expect(isRealtimeLive(true, null, SINCE, SINCE, AFTER)).toBe(true);
  });
});

describe('realtimeLiveChangeIn', () => {
  const SINCE = 1_000_000;

  it('says when a reconnect will become long enough to say so, then nothing', () => {
    expect(realtimeLiveChangeIn('reconnecting', SINCE, SINCE + 2_000, 5_000)).toBe(3_000);
    expect(realtimeLiveChangeIn('connecting', SINCE, SINCE + 5_000, 5_000)).toBeNull();
    expect(realtimeLiveChangeIn('live', SINCE, SINCE, 5_000)).toBeNull();
    expect(realtimeLiveChangeIn(null, SINCE, SINCE, 5_000)).toBeNull();
  });
});
