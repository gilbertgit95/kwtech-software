import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { NOTE_FEATURE, NOTE_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { NOTE_OPERATIONS } from '../src/operations.js';
import { NoteResolver } from '../src/server/graphql/note.resolver.js';

/**
 * ⚠ THE §12.13 TRAP, TURNED INTO A RED BUILD.
 *
 * Every `note:*` key is workspace level. A resolver with no declared scope
 * resolves at app level, where no workspace key participates, and every key
 * grants nothing to everybody — with no error. And there is no `@RequireFeature`
 * here, so a missing BINDING is not a documentation gap but an unguarded
 * operation. This suite checks all of it:
 *
 *   - the resolver declares workspace scope, and nothing on it is public;
 *   - every operation it publishes is bound to a key — notes have NO
 *     deliberately unbound operation;
 *   - no binding names an operation that does not exist;
 *   - the client's documents name exactly the published operations.
 */

/** Read out of the resolver's SOURCE, as the queue's and chat's suites do. */
function publishedOperations(): string[] {
  const source = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', 'note.resolver.ts'), 'utf8');
  return [...source.matchAll(/@(Query|Mutation|Subscription)\([\s\S]*?name:\s*'([^']+)'/g)].map(
    (match) => `${match[1]}.${match[2]}`,
  );
}

const OPERATIONS = publishedOperations();

const BOUND = new Map<string, string>();
for (const spec of NOTE_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) {
    if (binding.surface === 'graphql_operation' || binding.surface === 'graphql_subscription') {
      BOUND.set(binding.identifier, spec.key);
    }
  }
}

function handlers(): Array<[string, object]> {
  const prototype = NoteResolver.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .map((name) => [name, prototype[name] as object]);
}

describe('the notes resolver', () => {
  it('publishes operations — the reflection has to work for this suite to mean anything', () => {
    expect(OPERATIONS.length).toBe(14);
  });

  it('⚠ declares WORKSPACE scope on the class, so no operation can forget it', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, NoteResolver)).toEqual({ level: 'workspace' });
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

  it('binds reads to note:read and writes to note:write', () => {
    for (const [identifier, key] of BOUND) {
      const isOwnRow = identifier === 'Mutation.setNotePinned' || identifier === 'Mutation.setMyNoteSettings';
      const isRead = identifier.startsWith('Query.') || identifier.startsWith('Subscription.') || isOwnRow;
      expect([identifier, key]).toEqual([identifier, isRead ? NOTE_FEATURE.read : NOTE_FEATURE.write]);
    }
  });
});

describe('the bindings', () => {
  it('⚠ name no operation that is not published', () => {
    expect([...BOUND.keys()].filter((identifier) => !OPERATIONS.includes(identifier))).toEqual([]);
  });

  it('bind the subscription as a subscription surface', () => {
    const surfaces = NOTE_FEATURE_REGISTRY.flatMap((spec) => spec.bindings ?? []).filter((binding) =>
      binding.identifier.startsWith('Subscription.'),
    );
    expect(surfaces).toEqual([{ surface: 'graphql_subscription', identifier: 'Subscription.noteEvents' }]);
  });

  it('give manage_all none of its own — it is asked through the access port', () => {
    const manageAll = NOTE_FEATURE_REGISTRY.find((spec) => spec.key === NOTE_FEATURE.manageAll);
    expect(manageAll?.bindings).toEqual([]);
  });
});

describe('the documents the client sends', () => {
  it('cover exactly the published operations', () => {
    const fields = Object.values(NOTE_OPERATIONS).map((document) => {
      const match = /^\s*(query|mutation|subscription)\s+\w+[^{]*\{\s*(\w+)/.exec(document);
      const kind = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }[match?.[1] ?? 'query'];
      return `${kind}.${match?.[2]}`;
    });
    expect(fields.sort()).toEqual([...OPERATIONS].sort());
  });
});
