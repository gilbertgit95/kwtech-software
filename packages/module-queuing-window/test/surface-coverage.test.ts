import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { QUEUE_FEATURE, QUEUE_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { QueueResolver } from '../src/server/graphql/queue.resolver.js';
import { QueueDisplayResolver } from '../src/server/graphql/queue-display.resolver.js';

/**
 * ⚠ THE §12.13 TRAP, TURNED INTO A RED BUILD.
 *
 * Every `queue:*` key is workspace level. A resolver with no declared scope
 * resolves at app level, where no workspace key participates, and every key
 * grants nothing to everybody — with no error. And there is no `@RequireFeature`
 * here, so a missing BINDING is not a documentation gap but an unguarded
 * mutation. This suite checks all of it:
 *
 *   - the workspace resolver declares workspace scope, and nothing on it is public;
 *   - every operation it publishes is bound to a key, or named below;
 *   - no binding names an operation that does not exist;
 *   - the public resolver is public on every handler, marked as a credential
 *     surface, declares no scope, and binds no key.
 */

/**
 * Operations with NO key, and why. Both are the person's own remedy over their
 * own row, scoped to the workspace in the request — withholding either would be
 * a lockout dressed as a permission.
 *
 * ⚠ An unbound operation SKIPS the workspace-membership check (the guard only
 * resolves a scope when a key is required), which is why setting a nickname is
 * bound to `queue:read` rather than listed here: it WRITES a row into a
 * workspace, and these two only delete the caller's own.
 */
const DELIBERATELY_UNBOUND = new Set(['Mutation.releaseMyQueueSeat', 'Mutation.clearMyQueueNickname']);

/** Read out of the resolver's SOURCE, as chat's suite does — see there for why not metadata. */
function publishedOperations(file: string): string[] {
  const source = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', file), 'utf8');
  return [...source.matchAll(/@(Query|Mutation|Subscription)\([\s\S]*?name:\s*'([^']+)'/g)].map(
    (match) => `${match[1]}.${match[2]}`,
  );
}

const WORKSPACE_OPERATIONS = publishedOperations('queue.resolver.ts');
const PUBLIC_OPERATIONS = publishedOperations('queue-display.resolver.ts');

const BOUND = new Map<string, string>();
for (const spec of QUEUE_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) {
    if (binding.surface === 'graphql_operation' || binding.surface === 'graphql_subscription') {
      BOUND.set(binding.identifier, spec.key);
    }
  }
}

function handlers(target: { prototype: object }): Array<[string, object]> {
  const prototype = target.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .map((name) => [name, prototype[name] as object]);
}

describe('the workspace resolver', () => {
  it('publishes operations — the reflection has to work for this suite to mean anything', () => {
    expect(WORKSPACE_OPERATIONS.length).toBeGreaterThan(20);
  });

  it('⚠ declares WORKSPACE scope on the class, so no operation can forget it', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, QueueResolver)).toEqual({ level: 'workspace' });
  });

  it('marks nothing public', () => {
    for (const [name, handler] of handlers(QueueResolver)) {
      expect([name, Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
    }
  });

  it.each(WORKSPACE_OPERATIONS)('%s is bound to a key, or deliberately is not', (identifier) => {
    if (DELIBERATELY_UNBOUND.has(identifier)) {
      // Naming it AND binding it would be two answers to one question.
      expect(BOUND.get(identifier)).toBeUndefined();
      return;
    }
    expect(BOUND.get(identifier)).toBeDefined();
  });
});

describe('the public resolver', () => {
  it('publishes exactly the code exchange', () => {
    expect(PUBLIC_OPERATIONS).toEqual(['Mutation.openQueueDisplay']);
  });

  it('⚠ is public on every handler, with a reason, and marked as a credential surface', () => {
    const all = handlers(QueueDisplayResolver);
    expect(all.length).toBeGreaterThan(0);
    for (const [, handler] of all) {
      expect(Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler)).toEqual(expect.stringMatching(/\S/));
      expect(Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, handler)).toEqual(expect.stringMatching(/\S/));
    }
  });

  it('declares no scope — it names its workspace by key, and nobody is signed in', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, QueueDisplayResolver)).toBeUndefined();
  });

  it('⚠ binds no key — a key on a public operation would refuse every TV', () => {
    expect(PUBLIC_OPERATIONS.filter((identifier) => BOUND.has(identifier))).toEqual([]);
  });
});

describe('the bindings', () => {
  it('⚠ name no operation that is not published', () => {
    const published = new Set([...WORKSPACE_OPERATIONS, ...PUBLIC_OPERATIONS]);
    expect([...BOUND.keys()].filter((identifier) => !published.has(identifier))).toEqual([]);
  });

  it.each([
    ['Query.queueConsole', QUEUE_FEATURE.read],
    ['Mutation.setMyQueueNickname', QUEUE_FEATURE.read],
    ['Mutation.callNextQueueTicket', QUEUE_FEATURE.serve],
    ['Mutation.markQueueTicketNoShow', QUEUE_FEATURE.serve],
    ['Query.queueStaffCandidates', QUEUE_FEATURE.assignWindows],
    ['Mutation.assignQueueWindow', QUEUE_FEATURE.assignWindows],
    ['Mutation.setQueueLineNextNumber', QUEUE_FEATURE.manageWindows],
    ['Mutation.clearQueueNickname', QUEUE_FEATURE.manageWindows],
    // The people who can authorise a display are the people who can see what authorises it.
    ['Query.queueDisplayCode', QUEUE_FEATURE.start],
    ['Mutation.setQueueShowStaffNames', QUEUE_FEATURE.start],
    ['Mutation.stopQueue', QUEUE_FEATURE.stop],
  ])('%s → %s', (identifier, key) => {
    expect(BOUND.get(identifier)).toBe(key);
  });
});
