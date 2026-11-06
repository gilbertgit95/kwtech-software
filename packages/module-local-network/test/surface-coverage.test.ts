import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { LOCAL_NETWORK_FEATURE, LOCAL_NETWORK_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { LOCAL_NETWORK_OPERATIONS } from '../src/operations.js';
import { LocalNetworkResolver } from '../src/server/graphql/local-network.resolver.js';

/**
 * ⚠ THERE IS NO `@RequireFeature` HERE: the registry's bindings ARE the guard,
 * so an unbound operation is the page reachable by anybody signed in.
 */
function publishedOperations(): string[] {
  const source = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', 'local-network.resolver.ts'), 'utf8');
  return [...source.matchAll(/@(Query|Mutation)\([\s\S]*?name:\s*'([^']+)'/g)].map(
    (match) => `${match[1]}.${match[2]}`,
  );
}

const OPERATIONS = publishedOperations();
const BOUND = new Map<string, string>();
for (const spec of LOCAL_NETWORK_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) BOUND.set(binding.identifier, spec.key);
}

describe('the local network resolver', () => {
  it('publishes one query — the reflection has to work for this suite to mean anything', () => {
    expect(OPERATIONS).toEqual(['Query.localNetwork']);
  });

  it('⚠ declares NO scope: its key is app level', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, LocalNetworkResolver)).toBeUndefined();
  });

  it('⚠ binds the query to local_network:read', () => {
    expect(BOUND.get('Query.localNetwork')).toBe(LOCAL_NETWORK_FEATURE.read);
  });

  it('⚠ is neither public nor a credential surface', () => {
    const handler = (LocalNetworkResolver.prototype as unknown as Record<string, object>).view as object;
    expect(Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler)).toBeUndefined();
    expect(Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, handler)).toBeUndefined();
  });

  it('has a document the page sends for every operation, and no other', () => {
    const sent = Object.values(LOCAL_NETWORK_OPERATIONS).map((document) => {
      const kind = document.trimStart().startsWith('mutation') ? 'Mutation' : 'Query';
      return `${kind}.${/\{\s*(\w+)/u.exec(document)?.[1]}`;
    });
    expect(sent.sort()).toEqual([...OPERATIONS].sort());
  });
});
