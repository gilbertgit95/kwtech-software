import { assertRealtimeTopology } from '../src/realtime/realtime.pubsub.js';

/**
 * The engine choice, and the one boot refusal left.
 *
 * `assertRealtimeTopology` is pure precisely so this is assertable without a
 * Redis and without booting Nest: the failure it guards is one that, left
 * alone, produces NO error at runtime — just events that never arrive for most
 * users — so a test is the only place that silence is ever made visible.
 */
describe('assertRealtimeTopology', () => {
  it('runs the in-memory engine on a single replica with nothing configured', () => {
    expect(assertRealtimeTopology({ replicas: 1 })).toBe('memory');
    expect(assertRealtimeTopology({ replicas: 1, redisUrl: undefined })).toBe('memory');
  });

  /**
   * ⚠ THE WHOLE POINT OF THE REDESIGN. Setting REDIS_URL is all an operator has
   * to do: no second flag, no rebuild, no code change. This used to THROW,
   * telling them to follow a three-step migration in a source file.
   */
  it('⚠ runs on Redis as soon as a URL is configured, with no other change', () => {
    expect(assertRealtimeTopology({ replicas: 1, redisUrl: 'redis://localhost:6379' })).toBe('redis');
  });

  /**
   * ⚠ Configuring Redis BEFORE scaling is the order everybody should do it in,
   * so a single-replica deployment that has a Redis must not be punished for
   * getting it right.
   */
  it('does not require more than one replica to use a configured Redis', () => {
    expect(assertRealtimeTopology({ replicas: 1, redisUrl: 'redis://cache:6379' })).toBe('redis');
    expect(assertRealtimeTopology({ replicas: 8, redisUrl: 'redis://cache:6379' })).toBe('redis');
  });

  /**
   * ⚠ THE ONE REFUSAL LEFT, and it is the silent failure this file exists for:
   * an event published on replica A never reaches a socket held by replica B,
   * with nothing logged anywhere. Subscriptions look connected and deliver to a
   * fraction of users.
   */
  it('⚠ refuses a second replica with no Redis, naming the silent failure', () => {
    expect(() => assertRealtimeTopology({ replicas: 2 })).toThrow(/never reaches a socket held by another/);
    // The message says what to do about it, not only what is wrong.
    expect(() => assertRealtimeTopology({ replicas: 2 })).toThrow(/Set REDIS_URL/);
  });

  it('counts an empty REDIS_URL as unset rather than as configured', () => {
    // An env file with `REDIS_URL=` is somebody who has not set it. Treating the
    // empty string as configured would build a client for nowhere.
    expect(assertRealtimeTopology({ replicas: 1, redisUrl: '' })).toBe('memory');
    expect(() => assertRealtimeTopology({ replicas: 2, redisUrl: '' })).toThrow(/serves exactly one/);
  });
});
