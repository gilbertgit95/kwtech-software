import { assertRealtimeTopology } from '../src/realtime/realtime.pubsub.js';

/**
 * The boot refusals, tested without booting.
 *
 * `assertRealtimeTopology` is pure precisely so these two cases are assertable:
 * both of them are failures that, left alone, produce NO error at runtime —
 * just events that never arrive for most users — so the test is the only place
 * the silence is ever made visible.
 */
describe('assertRealtimeTopology', () => {
  it('runs the in-memory engine on a single replica', () => {
    expect(assertRealtimeTopology({ replicas: 1 })).toBe('memory');
    expect(assertRealtimeTopology({ replicas: 1, redisUrl: undefined })).toBe('memory');
  });

  it('refuses a second replica on the in-memory engine, naming the silent failure', () => {
    expect(() => assertRealtimeTopology({ replicas: 2 })).toThrow(/never reaches a socket held by another/);
  });

  it('refuses a configured REDIS_URL rather than ignoring it', () => {
    // Starting anyway would report a migration that has not happened.
    expect(() => assertRealtimeTopology({ replicas: 1, redisUrl: 'redis://localhost:6379' })).toThrow(
      /driver is not installed yet/,
    );
  });

  it('names REDIS_URL first when both are set, because that is the actionable one', () => {
    expect(() => assertRealtimeTopology({ replicas: 4, redisUrl: 'redis://localhost:6379' })).toThrow(
      /driver is not installed yet/,
    );
  });
});
