import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { BOOKS_FEATURE, BOOKS_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { BOOKS_OPERATIONS } from '../src/operations.js';
import { BooksResolver } from '../src/server/graphql/books.resolver.js';
import { BooksInvestorResolver } from '../src/server/graphql/books-investor.resolver.js';

/**
 * ⚠ THE §12.13 TRAP, TURNED INTO A RED BUILD — the point of sale's suite, for
 * the books.
 *
 * Every `books:*` key is workspace level. A resolver with no declared scope
 * resolves at app level, where no workspace key participates, and every key
 * grants nothing to everybody — with no error. And there is no
 * `@RequireFeature` here, so a missing BINDING is an unguarded operation: who
 * is owed what, readable by anybody signed in.
 */

const GRAPHQL_DIR = join(__dirname, '..', 'src', 'server', 'graphql');
const RESOLVERS = [BooksResolver, BooksInvestorResolver];

/** Every operation any resolver file publishes, read from the source. */
function publishedOperations(): string[] {
  const files = readdirSync(GRAPHQL_DIR).filter((file) => file.endsWith('.resolver.ts'));
  return files.flatMap((file) => {
    const source = readFileSync(join(GRAPHQL_DIR, file), 'utf8');
    return [...source.matchAll(/@(Query|Mutation|Subscription)\([\s\S]*?name:\s*'([^']+)'/g)].map(
      (match) => `${match[1]}.${match[2]}`,
    );
  });
}

const OPERATIONS = publishedOperations();

const BOUND = new Map<string, string>();
for (const spec of BOOKS_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) BOUND.set(binding.identifier, spec.key);
}

function handlers(resolver: { prototype: object }): Array<[string, object]> {
  const prototype = resolver.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .map((name) => [name, prototype[name] as object]);
}

describe('the books resolvers', () => {
  it('publish operations — the reflection has to work for this suite to mean anything', () => {
    expect(OPERATIONS.length).toBeGreaterThanOrEqual(16);
  });

  it('⚠ are every resolver class in the folder, so a new one cannot skip these checks', () => {
    const files = readdirSync(GRAPHQL_DIR).filter((file) => file.endsWith('.resolver.ts'));
    expect(files.length).toBe(RESOLVERS.length);
  });

  it.each(RESOLVERS.map((resolver) => [resolver.name, resolver] as const))(
    '⚠ %s declares WORKSPACE scope on the class, so no operation can forget it',
    (_name, resolver) => {
      expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, resolver)).toEqual({ level: 'workspace' });
    },
  );

  it('mark nothing public, and nothing a credential surface', () => {
    for (const resolver of RESOLVERS) {
      for (const [name, handler] of handlers(resolver)) {
        expect([name, Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
        expect([name, Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
      }
    }
  });

  it.each(OPERATIONS)('⚠ %s is bound to a key', (identifier) => {
    expect(BOUND.get(identifier)).toBeDefined();
  });

  it('⚠ bind every operation on the investors resolver to books:manage_investors', () => {
    const source = readFileSync(join(GRAPHQL_DIR, 'books-investor.resolver.ts'), 'utf8');
    const names = [...source.matchAll(/@(Query|Mutation)\([\s\S]*?name:\s*'([^']+)'/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(names.length).toBeGreaterThan(0);
    for (const identifier of names)
      expect([identifier, BOUND.get(identifier)]).toEqual([identifier, BOOKS_FEATURE.manageInvestors]);
  });

  it('⚠ keep paying investors off books:record, and reading on books:read', () => {
    expect(BOUND.get('Mutation.recordBooksInvestorEntry')).toBe(BOOKS_FEATURE.manageInvestors);
    expect(BOUND.get('Mutation.shareBooksProfit')).toBe(BOOKS_FEATURE.manageInvestors);
    expect(BOUND.get('Query.booksOverview')).toBe(BOOKS_FEATURE.read);
    expect(BOUND.get('Mutation.recordBooksEntry')).toBe(BOOKS_FEATURE.record);
  });
});

describe('the bindings', () => {
  it('⚠ name no operation that is not published', () => {
    expect([...BOUND.keys()].filter((identifier) => !OPERATIONS.includes(identifier))).toEqual([]);
  });

  it('bind each operation exactly once', () => {
    const identifiers = BOOKS_FEATURE_REGISTRY.flatMap((spec) => (spec.bindings ?? []).map((b) => b.identifier));
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it('bind the subscription as a subscription surface', () => {
    const surfaces = BOOKS_FEATURE_REGISTRY.flatMap((spec) => spec.bindings ?? []).filter((binding) =>
      binding.identifier.startsWith('Subscription.'),
    );
    expect(surfaces).toEqual([{ surface: 'graphql_subscription', identifier: 'Subscription.booksEvents' }]);
  });
});

describe('the documents the client sends', () => {
  it('cover exactly the published operations', () => {
    const fields = Object.values(BOOKS_OPERATIONS).map((document) => {
      const match = /^\s*(query|mutation|subscription)\s+\w+[^{]*\{\s*(\w+)/.exec(document);
      const kind = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }[match?.[1] ?? 'query'];
      return `${kind}.${match?.[2]}`;
    });
    expect(fields.sort()).toEqual([...OPERATIONS].sort());
  });
});
