import {
  closeEvent,
  MAX_RECONNECT_DELAY_MS,
  nextRealtimeStatus,
  REALTIME_REFUSED_CODE,
  reconnectDelay,
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
