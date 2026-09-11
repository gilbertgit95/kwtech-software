import { PubSub } from 'graphql-subscriptions';
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
 * ## Today: ONE REPLICA, DELIBERATELY
 *
 * `graphql-subscriptions`' in-memory `PubSub` serves exactly the sockets this
 * process holds. That is a considered choice for now rather than an oversight
 * (PLAN §12.28), and `assertRealtimeTopology` below is what keeps it from
 * quietly becoming a bug the day someone scales the deployment.
 *
 * ## Tomorrow: Redis, and the whole change is in this file
 *
 * `graphql-redis-subscriptions` implements the same shape, so no resolver, no
 * module and no port changes. The migration is:
 *
 *   1. pnpm add graphql-redis-subscriptions ioredis   (in apps/web-server)
 *   2. return a RedisPubSub built from `env.REDIS_URL` in `createEngine` below
 *   3. delete the 'configured but not wired' branch in assertRealtimeTopology
 *
 * ⚠ Nothing else. If a future change to this file needs a fourth step, that
 * step is a leak of the engine into somewhere it should not have reached.
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
 * Pure, and exported, so its two refusals are tested without booting Nest.
 */
export function assertRealtimeTopology(topology: RealtimeTopology): RealtimeEngine {
  const { replicas, redisUrl } = topology;

  /*
   * A configured backend that is not wired must FAIL, never be ignored.
   *
   * Setting REDIS_URL is somebody stating an intention — usually the same
   * somebody who is about to add replicas. Starting anyway on the in-memory
   * engine would tell them the migration is done when nothing about the process
   * changed, and the first symptom would be the silent one above.
   */
  if (redisUrl) {
    throw new Error(
      'REDIS_URL is set, but the Redis pub/sub driver is not installed yet. ' +
        'Follow the three-step migration at the top of src/realtime/realtime.pubsub.ts, ' +
        'or unset REDIS_URL to run on the single-replica in-memory engine.',
    );
  }

  if (replicas > 1) {
    throw new Error(
      `REALTIME_REPLICAS is ${replicas}, and the in-memory pub/sub engine serves exactly one. ` +
        'An event published on one replica never reaches a socket held by another, silently — ' +
        'subscriptions would appear to work and deliver nothing to most users. ' +
        'Configure REDIS_URL and install the driver (see src/realtime/realtime.pubsub.ts), ' +
        'or run a single replica.',
    );
  }

  return 'memory';
}

function createEngine(engine: RealtimeEngine): RealtimePubSub {
  /*
   * One `switch` with one arm today, which is the shape the second arm slots
   * into. `assertRealtimeTopology` has already refused everything this cannot
   * build, so there is no fallback here and no default that guesses.
   */
  switch (engine) {
    case 'memory':
      return new PubSub();
    case 'redis':
      throw new Error('The Redis engine is not wired yet — see the migration note in this file.');
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
    instance = createEngine(assertRealtimeTopology({ replicas: env.REALTIME_REPLICAS, redisUrl: env.REDIS_URL }));
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
