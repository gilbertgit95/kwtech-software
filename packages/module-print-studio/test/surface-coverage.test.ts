import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { STUDIO_FEATURE, STUDIO_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { STUDIO_OPERATIONS } from '../src/operations.js';
import { StudioResolver } from '../src/server/graphql/studio.resolver.js';

/**
 * ⚠ THE §12.13 TRAP, TURNED INTO A RED BUILD.
 *
 * Every `studio:*` key is workspace level. A resolver with no declared scope
 * resolves at app level, where no workspace key participates, and every key
 * grants nothing to everybody — with no error. And there is no `@RequireFeature`
 * here, so a missing BINDING is not a documentation gap but an unguarded
 * operation. This suite checks all of it:
 *
 *   - the resolver declares workspace scope, and nothing on it is public;
 *   - every operation it publishes is bound to a key — the studio has NO
 *     deliberately unbound operation;
 *   - no binding names an operation that does not exist;
 *   - the client's documents name exactly the published operations;
 *   - nothing on the surface could carry a file.
 */

const RESOLVER_SOURCE = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', 'studio.resolver.ts'), 'utf8');
const TYPES_SOURCE = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', 'studio.types.ts'), 'utf8');

/** Read out of the resolver's SOURCE, as the queue's and notes' suites do. */
const OPERATIONS = [...RESOLVER_SOURCE.matchAll(/@(Query|Mutation|Subscription)\([\s\S]*?name:\s*'([^']+)'/g)].map(
  (match) => `${match[1]}.${match[2]}`,
);

const BOUND = new Map<string, string>();
for (const spec of STUDIO_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) BOUND.set(binding.identifier, spec.key);
}

/** The person's own rows: written under `studio:read`, which proves membership of the workspace. */
const OWN_ROW_WRITES = [
  'Mutation.saveStudioCalibration',
  'Mutation.deleteStudioCalibration',
  'Mutation.recordStudioPrint',
];

function handlers(): Array<[string, object]> {
  const prototype = StudioResolver.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .map((name) => [name, prototype[name] as object]);
}

describe('the studio resolver', () => {
  it('publishes operations — the reflection has to work for this suite to mean anything', () => {
    expect(OPERATIONS.length).toBe(14);
  });

  it('⚠ declares WORKSPACE scope on the class, so no operation can forget it', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, StudioResolver)).toEqual({ level: 'workspace' });
  });

  it('marks nothing public, and nothing a credential surface', () => {
    for (const [name, handler] of handlers()) {
      expect([name, Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
      expect([name, Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
    }
  });

  it.each(OPERATIONS)('⚠ %s is bound to a key', (identifier) => {
    expect(BOUND.get(identifier)).toBeDefined();
  });

  it('binds reads and the person’s own rows to studio:read, layout writes to studio:write, and the keymap to its own key', () => {
    for (const [identifier, key] of BOUND) {
      if (identifier === 'Mutation.saveStudioSettings') {
        expect(key).toBe(STUDIO_FEATURE.manageSettings);
        continue;
      }
      const isRead = identifier.startsWith('Query.') || OWN_ROW_WRITES.includes(identifier);
      expect([identifier, key]).toEqual([identifier, isRead ? STUDIO_FEATURE.read : STUDIO_FEATURE.write]);
    }
  });

  it('⚠ has no field that could carry a file — only file NAMES', () => {
    // Decision 8: photos and results never reach the server. A field added for one would show here.
    const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(/upload|multipart/i.test(strip(RESOLVER_SOURCE))).toBe(false);
    expect(/upload|bytes|blob|content|data(?!\w)|file(?!Names)/i.test(strip(TYPES_SOURCE))).toBe(false);
  });
});

describe('the bindings', () => {
  it('⚠ name no operation that is not published', () => {
    expect([...BOUND.keys()].filter((identifier) => !OPERATIONS.includes(identifier))).toEqual([]);
  });

  it('give manage_all none of its own — it is asked through the access port', () => {
    const manageAll = STUDIO_FEATURE_REGISTRY.find((spec) => spec.key === STUDIO_FEATURE.manageAll);
    expect(manageAll?.bindings).toEqual([]);
  });
});

describe('the documents the client sends', () => {
  it('cover exactly the published operations', () => {
    const fields = Object.values(STUDIO_OPERATIONS).map((document) => {
      const match = /^\s*(query|mutation|subscription)\s+\w+[^{]*\{\s*(\w+)/.exec(document);
      const kind = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }[match?.[1] ?? 'query'];
      return `${kind}.${match?.[2]}`;
    });
    expect(fields.sort()).toEqual([...OPERATIONS].sort());
  });
});
