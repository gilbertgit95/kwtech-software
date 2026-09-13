import { RedisPubSub } from 'graphql-redis-subscriptions';
import { PubSub } from 'graphql-subscriptions';
// ⚠ The NAMED export, not the default. ioredis is CJS, and under NodeNext its
// default import resolves to the module namespace — which is neither
// constructable nor usable as a type.
import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/**
 * THE ONE PLACE THIS APPLICATION DECIDES HOW EVENTS TRAVEL.
 *
 * Every module that publishes — `module-permissions` today, `module-chat` next,
 * whatever follows — declares its own structural port (`PermissionsPubSub`, and
 * the identical `ChatPubSub` to come) and never picks an engine. Which engine
 * is a DEPLOYMENT fact, so the app owns it, and it owns it HERE rather than in
 * `app.module.ts`: the binding there used to be `new PubSub()` written inline,
 * which meant the second module to want events would have written a second one,
 * and two instances in one process do not see each other's publishes. A module
 * subscribing on instance B would silently never receive what instance A sent.
 *
 * So the rule is: a module's pub/sub token binds to `realtimePubSub()`, never
 * to a constructor. One engine per process, chosen once, swapped once.
 *
 * ## ⚠ THE ENGINE IS A CONFIGURATION, NOT A CODE CHANGE
 *
 * **Set `REDIS_URL` and this process runs on Redis. Leave it unset and it runs
 * in memory.** That is the whole of it — no rebuild, no edit here, no flag to
 * remember, and nothing to deploy but an environment variable.
 *
 * This file used to say the opposite: both drivers were not installed, a set
 * `REDIS_URL` FAILED THE BOOT, and the comment carried a three-step migration
 * for somebody to perform later. That was the wrong shape for the decision.
 * Scaling out is an operational act, usually urgent, and it should not require
 * a developer, a pull request and a release to complete — the operator who
 * provisions a Redis is the one who needed it, and they need it now.
 *
 * It also removes the only genuinely dangerous state the old design had: a
 * deployment carrying a `REDIS_URL` that nothing reads. With the driver absent
 * that was a boot failure, which is loud but is still an outage caused by
 * configuring the thing correctly.
 *
 * ⚠ WHAT IS STILL REFUSED: more than one replica with NO `REDIS_URL`. That is
 * the silent failure this file exists for — an event published on replica A
 * never reaches a socket held by replica B, with nothing logged — and it is now
 * the only refusal left.
 *
 * ⚠ The modules did not change and cannot: `graphql-redis-subscriptions`
 * implements the same shape as the in-memory engine, so no resolver, no module
 * and no port knows which one it got. A change here that needed an edit in a
 * module would be a leak of the engine into somewhere it must not reach.
 */

/**
 * Publish and subscribe, and nothing else — the union of what every module port
 * asks for, so one instance satisfies all of them.
 *
 * Deliberately a structural duplicate of `PermissionsPubSub` rather than an
 * import of it. This is the APP's contract with its own modules; importing one
 * module's port to serve another would make `module-chat`'s events depend on
 * `module-permissions` being installed, which is exactly the coupling §9
 * prohibits.
 */
export interface RealtimePubSub {
  publish(trigger: string, payload: unknown): Promise<void>;
  asyncIterableIterator<T>(triggers: string | readonly string[]): AsyncIterableIterator<T>;
}

/** What the process is actually running. Reported at boot so it is never guessed. */
export type RealtimeEngine = 'memory' | 'redis';

export interface RealtimeTopology {
  /** How many replicas of `apps/web-server` this deployment runs. */
  replicas: number;
  /** Set once a distributed engine is configured; absent means in-memory. */
  redisUrl?: string | undefined;
}

/**
 * Refuses to start a deployment whose topology the engine cannot serve.
 *
 * ⚠ THIS IS THE WHOLE POINT OF THE FILE. In-memory pub/sub past one replica
 * does not error, log, or degrade — an event published on replica A simply
 * never reaches a socket held by replica B. For a plan badge that is a stale
 * screen; for a message it is a product that loses mail, and the sender sees a
 * sent message while the recipient sees nothing. A failure that silent has to
 * be converted into one that is loud, and boot is the only moment anybody is
 * looking.
 *
 * Declared rather than detected, because a process cannot count its own
 * siblings. `REALTIME_REPLICAS` is the operator saying what they deployed, and
 * the honest limit of that is stated in .env.example: scale the deployment
 * without raising it and this check passes while the product is broken. It
 * catches the deliberate scale-up, which is the realistic case — nobody adds a
 * replica by accident.
 *
 * Pure, and exported, so it is tested without booting Nest — and it now
 * CHOOSES as well as refuses, which is what makes the engine a configuration.
 */
export function assertRealtimeTopology(topology: RealtimeTopology): RealtimeEngine {
  const { replicas, redisUrl } = topology;

  /*
   * ⚠ A CONFIGURED BACKEND IS SIMPLY USED. No second flag to set, no build to
   * cut. Somebody who provisions a Redis and points this at it has said
   * everything they need to say, and the process obeys on its next restart.
   *
   * The replica count is not consulted in this branch on purpose: Redis serves
   * one replica perfectly well, and refusing a single-replica deployment that
   * happens to have a Redis would punish the operator who configured it BEFORE
   * scaling — which is the order everyone should do it in.
   */
  if (redisUrl) return 'redis';

  if (replicas > 1) {
    throw new Error(
      `REALTIME_REPLICAS is ${replicas}, and the in-memory pub/sub engine serves exactly one. ` +
        'An event published on one replica never reaches a socket held by another, silently — ' +
        'subscriptions would appear to work and deliver nothing to most users. ' +
        'Set REDIS_URL to run on the distributed engine, or run a single replica.',
    );
  }

  return 'memory';
}

/**
 * ONE ioredis connection, configured the way a pub/sub client has to be.
 *
 * ⚠ TWO OF THESE ARE NEEDED, not one. A Redis connection in subscriber mode
 * accepts no other commands, so publishing down the same socket fails —
 * `RedisPubSub` takes a separate `publisher` and `subscriber` for exactly that
 * reason, and handing it one client twice is a bug that only appears on the
 * first publish after the first subscribe.
 */
function redisConnection(url: string, role: 'publisher' | 'subscriber'): Redis {
  /*
   * ⚠ The options are written INLINE rather than annotated `RedisOptions`. This
   * repo compiles with `exactOptionalPropertyTypes`, and ioredis' own option
   * type declares several properties as non-optional-with-a-union, so the
   * annotated object is not assignable to the constructor's parameter. Inline,
   * TypeScript infers exactly the two keys present and both are checked.
   */
  const client = new Redis(url, {
    /*
     * ⚠ `null`, NOT the default of 20. That default makes a command fail once
     * the connection has been down for twenty retries — sensible for a request
     * that has somebody waiting on it, wrong for a subscriber whose whole job
     * is to still be there when the network comes back. A chat that stops
     * delivering after a blip and never resumes is the failure this engine
     * exists to prevent.
     */
    maxRetriesPerRequest: null,
    /** Keep trying, backing off to a ceiling rather than growing without bound. */
    retryStrategy: (times: number) => Math.min(times * 200, 5000),
  });

  /*
   * ⚠ AN 'error' LISTENER IS NOT OPTIONAL. ioredis is an EventEmitter, and an
   * emitter that emits 'error' with nothing listening THROWS — so a Redis that
   * is briefly unreachable would take the process down rather than reconnect.
   *
   * Logged rather than swallowed: the retry strategy handles recovery, and an
   * operator reading the logs is the only one who can act on a URL that is
   * simply wrong.
   */
  client.on('error', (error: Error) => {
    console.error(`[realtime] redis ${role} connection error: ${error.message}`);
  });

  return client;
}

function createEngine(engine: RealtimeEngine, redisUrl?: string): RealtimePubSub {
  /*
   * `assertRealtimeTopology` has already refused everything this cannot build,
   * so there is no fallback here and no default that guesses.
   *
   * ⚠ IN PARTICULAR THERE IS NO "Redis was asked for but could not be reached,
   * carry on in memory" PATH. That is the silent failure in a different
   * costume: a replica quietly serving its own sockets while three others do
   * the same is precisely the arrangement this file exists to prevent, and it
   * would happen at the worst moment — when the backend is already unwell.
   *
   * ⚠ WHAT DOES HAPPEN WHEN REDIS IS DOWN, since it is not obvious and was
   * verified rather than assumed: construction SUCCEEDS, the process starts,
   * HTTP serves normally, and the two connections retry with backoff, logging
   * each failure. Realtime is broken until Redis returns, and then recovers by
   * itself. The alternative — failing the boot — would mean a Redis blip during
   * a deploy takes down every REST and GraphQL path in the product, none of
   * which needs pub/sub. Degrading one feature beats losing all of them, and
   * the log is loud about which one.
   */
  switch (engine) {
    case 'memory':
      return new PubSub();
    case 'redis': {
      if (!redisUrl) throw new Error('The Redis engine was selected without a REDIS_URL. This is a bug.');
      return new RedisPubSub({
        publisher: redisConnection(redisUrl, 'publisher'),
        subscriber: redisConnection(redisUrl, 'subscriber'),
      });
    }
  }
}

let instance: RealtimePubSub | undefined;

/**
 * The process-wide engine. Created on first use, then shared.
 *
 * A SINGLETON on purpose, and not the DI kind: the pub/sub token of each module
 * is supplied as `useValue` into a dynamically-composed `forRoot()`, so a Nest
 * provider would have to be exported from a module every one of those imports —
 * a wiring step per module, which is the per-module edit the descriptor pattern
 * exists to remove. A module-scope value has the same lifetime and none of that.
 *
 * ⚠ Which makes it the reason `assertRealtimeTopology` must not live in a
 * request path: it runs once, at the first bind, before anything is served.
 */
export function realtimePubSub(): RealtimePubSub {
  if (!instance) {
    const engine = assertRealtimeTopology({ replicas: env.REALTIME_REPLICAS, redisUrl: env.REDIS_URL });
    /*
     * ⚠ SAID OUT LOUD, because the whole design is that this is decided by
     * configuration rather than by code — and a decision made from the
     * environment is one nobody can read off the source. An operator who set
     * REDIS_URL needs to see, in the boot log, that this process agreed.
     */
    console.log(`[realtime] pub/sub engine: ${engine} (replicas: ${env.REALTIME_REPLICAS})`);
    instance = createEngine(engine, env.REDIS_URL);
  }
  return instance;
}

/**
 * Whether events reach every replica — the question a FUTURE feature has to ask
 * before it ships, rather than one anything needs today.
 *
 * Presence is the known case (PLAN §12.28): pub/sub across replicas fails
 * silently, but presence across replicas fails LOUDLY and constantly, with half
 * of everybody shown permanently offline. A feature like that refuses to
 * register rather than shipping broken, and this is what it asks.
 */
export function realtimeIsDistributed(): boolean {
  return Boolean(env.REDIS_URL);
}
