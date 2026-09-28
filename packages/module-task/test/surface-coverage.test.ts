import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { TASK_FEATURE, TASK_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { TASK_OPERATIONS } from '../src/operations.js';
import { TaskResolver } from '../src/server/graphql/task.resolver.js';

/**
 * ⚠ THE §12.13 TRAP, TURNED INTO A RED BUILD — `module-note`'s suite, for tasks.
 *
 * Every `task:*` key is workspace level. A resolver with no declared scope
 * resolves at app level, where no workspace key participates, and every key
 * grants nothing to everybody — with no error. And there is no
 * `@RequireFeature` here, so a missing BINDING is an unguarded operation.
 */

function publishedOperations(): string[] {
  const source = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', 'task.resolver.ts'), 'utf8');
  return [...source.matchAll(/@(Query|Mutation|Subscription)\([\s\S]*?name:\s*'([^']+)'/g)].map(
    (match) => `${match[1]}.${match[2]}`,
  );
}

const OPERATIONS = publishedOperations();

const BOUND = new Map<string, string>();
for (const spec of TASK_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) {
    if (binding.surface === 'graphql_operation' || binding.surface === 'graphql_subscription') {
      BOUND.set(binding.identifier, spec.key);
    }
  }
}

function handlers(): Array<[string, object]> {
  const prototype = TaskResolver.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .map((name) => [name, prototype[name] as object]);
}

describe('the tasks resolver', () => {
  it('publishes operations — the reflection has to work for this suite to mean anything', () => {
    expect(OPERATIONS.length).toBe(39);
  });

  it('⚠ declares WORKSPACE scope on the class, so no operation can forget it', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, TaskResolver)).toEqual({ level: 'workspace' });
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

  it('binds every read to task:read, except the two that reveal more than your own boards', () => {
    const elsewhere: Record<string, string> = {
      'Query.taskAssignableMembers': TASK_FEATURE.assign,
      'Query.orphanedTaskBoards': TASK_FEATURE.manageAll,
    };
    for (const [identifier, key] of BOUND) {
      if (!identifier.startsWith('Query.') && !identifier.startsWith('Subscription.')) continue;
      expect([identifier, key]).toEqual([identifier, elsewhere[identifier] ?? TASK_FEATURE.read]);
    }
  });

  it('binds every board-configuring mutation to task:create_boards', () => {
    for (const [identifier, key] of BOUND) {
      if (
        /Mutation\.(createTaskBoard|updateTaskBoard|setTaskBoardVisibility|\w+TaskColumn|\w+TaskBoard\w*)$/.test(
          identifier,
        )
      ) {
        if (identifier === 'Mutation.transferTaskBoard') continue;
        expect([identifier, key]).toEqual([identifier, TASK_FEATURE.createBoards]);
      }
    }
  });
});

describe('the bindings', () => {
  it('⚠ name no operation that is not published', () => {
    expect([...BOUND.keys()].filter((identifier) => !OPERATIONS.includes(identifier))).toEqual([]);
  });

  it('bind the subscription as a subscription surface', () => {
    const surfaces = TASK_FEATURE_REGISTRY.flatMap((spec) => spec.bindings ?? []).filter((binding) =>
      binding.identifier.startsWith('Subscription.'),
    );
    expect(surfaces).toEqual([{ surface: 'graphql_subscription', identifier: 'Subscription.taskEvents' }]);
  });
});

describe('the documents the client sends', () => {
  it('cover exactly the published operations', () => {
    const fields = Object.values(TASK_OPERATIONS).map((document) => {
      const match = /^\s*(query|mutation|subscription)\s+\w+[^{]*\{\s*(\w+)/.exec(document);
      const kind = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }[match?.[1] ?? 'query'];
      return `${kind}.${match?.[2]}`;
    });
    expect(fields.sort()).toEqual([...OPERATIONS].sort());
  });
});
