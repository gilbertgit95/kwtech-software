import { MAX_RECONNECT_DELAY_MS, reconnectDelay } from '../src/realtime.js';

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
