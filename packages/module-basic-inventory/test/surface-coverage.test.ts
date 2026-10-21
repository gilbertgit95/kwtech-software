import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { STOCK_FEATURE, STOCK_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { STOCK_OPERATIONS } from '../src/operations.js';
import { StockResolver } from '../src/server/graphql/stock.resolver.js';

/**
 * ⚠ THE §12.13 TRAP, TURNED INTO A RED BUILD — the books' suite, for stock.
 *
 * Every `stock:*` key is workspace level. A resolver with no declared scope
 * resolves at app level, where no workspace key participates, and every key
 * grants nothing to everybody — with no error. And there is no
 * `@RequireFeature` here, so a missing BINDING is an unguarded operation: a
 * stock take confirmed by anybody signed in.
 */

const GRAPHQL_DIR = join(__dirname, '..', 'src', 'server', 'graphql');
const RESOLVERS = [StockResolver];

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
for (const spec of STOCK_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) BOUND.set(binding.identifier, spec.key);
}

function handlers(resolver: { prototype: object }): Array<[string, object]> {
  const prototype = resolver.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .map((name) => [name, prototype[name] as object]);
}

describe('the stock resolver', () => {
  it('publish operations — the reflection has to work for this suite to mean anything', () => {
    expect(OPERATIONS.length).toBeGreaterThanOrEqual(20);
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

  it('⚠ keep the counter’s work off stock:manage, and what overwrites on hand on it', () => {
    expect(BOUND.get('Query.stockItems')).toBe(STOCK_FEATURE.read);
    expect(BOUND.get('Mutation.receiveStock')).toBe(STOCK_FEATURE.receive);
    expect(BOUND.get('Mutation.recordStockWaste')).toBe(STOCK_FEATURE.receive);
    expect(BOUND.get('Mutation.confirmStockTake')).toBe(STOCK_FEATURE.manage);
    expect(BOUND.get('Mutation.setStockUses')).toBe(STOCK_FEATURE.manage);
  });
});

describe('the bindings', () => {
  it('⚠ name no operation that is not published', () => {
    expect([...BOUND.keys()].filter((identifier) => !OPERATIONS.includes(identifier))).toEqual([]);
  });

  it('bind each operation exactly once', () => {
    const identifiers = STOCK_FEATURE_REGISTRY.flatMap((spec) => (spec.bindings ?? []).map((b) => b.identifier));
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it('bind the subscription as a subscription surface', () => {
    const surfaces = STOCK_FEATURE_REGISTRY.flatMap((spec) => spec.bindings ?? []).filter((binding) =>
      binding.identifier.startsWith('Subscription.'),
    );
    expect(surfaces).toEqual([{ surface: 'graphql_subscription', identifier: 'Subscription.stockEvents' }]);
  });
});

describe('the documents the client sends', () => {
  it('cover exactly the published operations', () => {
    const fields = Object.values(STOCK_OPERATIONS).map((document) => {
      const match = /^\s*(query|mutation|subscription)\s+\w+[^{]*\{\s*(\w+)/.exec(document);
      const kind = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }[match?.[1] ?? 'query'];
      return `${kind}.${match?.[2]}`;
    });
    expect(fields.sort()).toEqual([...OPERATIONS].sort());
  });
});
