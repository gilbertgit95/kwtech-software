import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { JOBS_FEATURE, JOBS_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { JOBS_OPERATIONS } from '../src/operations.js';
import { JobsResolver } from '../src/server/graphql/jobs.resolver.js';

/**
 * ⚠ THERE IS NO `@RequireFeature` HERE, so a missing BINDING is not a
 * documentation gap but an unguarded mutation — one that pauses every
 * organization's reminders for anybody signed in. This suite checks:
 *
 *   - every operation the resolver publishes is bound to a key (none is
 *     deliberately unbound: nothing here is a person's own remedy);
 *   - no binding names an operation that does not exist;
 *   - the resolver declares NO scope (every key is app level) and nothing on
 *     it is public;
 *   - every operation has a document the page sends, and the reverse.
 */

/** Read out of the resolver's SOURCE, as the queue's suite does. */
function publishedOperations(file: string): string[] {
  const source = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', file), 'utf8');
  return [...source.matchAll(/@(Query|Mutation|Subscription)\([\s\S]*?name:\s*'([^']+)'/g)].map(
    (match) => `${match[1]}.${match[2]}`,
  );
}

const OPERATIONS = publishedOperations('jobs.resolver.ts');

const BOUND = new Map<string, string>();
for (const spec of JOBS_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) BOUND.set(binding.identifier, spec.key);
}

function handlers(target: { prototype: object }): Array<[string, object]> {
  const prototype = target.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .map((name) => [name, prototype[name] as object]);
}

describe('the admin resolver', () => {
  it('publishes operations — the reflection has to work for this suite to mean anything', () => {
    expect(OPERATIONS).toHaveLength(7);
  });

  it('⚠ declares NO scope — every key is app level, and a scope would ask inside one tenant', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, JobsResolver)).toBeUndefined();
  });

  it('marks nothing public, and nothing a credential surface', () => {
    for (const [name, handler] of handlers(JobsResolver)) {
      expect([name, Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
      expect([name, Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
    }
  });

  it.each(OPERATIONS)('⚠ %s is bound to a key', (identifier) => {
    expect(BOUND.get(identifier)).toBeDefined();
  });
});

describe('the bindings', () => {
  it('⚠ name no operation that is not published', () => {
    const published = new Set(OPERATIONS);
    expect([...BOUND.keys()].filter((identifier) => !published.has(identifier))).toEqual([]);
  });

  it.each([
    ['Query.jobProcesses', JOBS_FEATURE.read],
    ['Query.jobProcessHistory', JOBS_FEATURE.read],
    ['Mutation.pauseJobProcess', JOBS_FEATURE.pause],
    // Whoever may stop it may start it again: one key, so a pause is never a one-way door.
    ['Mutation.resumeJobProcess', JOBS_FEATURE.pause],
    ['Mutation.runJobProcessNow', JOBS_FEATURE.run],
    ['Mutation.setJobProcessSchedule', JOBS_FEATURE.schedule],
    ['Mutation.resetJobProcessSchedule', JOBS_FEATURE.schedule],
  ])('%s → %s', (identifier, key) => {
    expect(BOUND.get(identifier)).toBe(key);
  });
});

describe('the documents the page sends', () => {
  it('are one per published operation, by name', () => {
    expect(Object.keys(JOBS_OPERATIONS).sort()).toEqual(
      OPERATIONS.map((identifier) => identifier.split('.')[1] ?? '').sort(),
    );
  });
});
