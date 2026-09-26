import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { APP_HUB_FEATURE, APP_HUB_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { APP_HUB_OPERATIONS } from '../src/operations.js';
import { AppHubResolver } from '../src/server/graphql/app-hub.resolver.js';

/**
 * ⚠ THE §12.13 TRAP, TURNED INTO A RED BUILD, as the queue's suite does.
 *
 * Both keys are workspace level: a resolver with no declared scope resolves at
 * app level and refuses everybody. And with no `@RequireFeature` here, a
 * missing BINDING is an operation any signed-in person could call for any
 * workspace they name. Every operation is bound — none is deliberately unbound.
 */

/** Read out of the resolver's SOURCE, as the queue's and chat's suites do. */
const OPERATIONS = [
  ...readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', 'app-hub.resolver.ts'), 'utf8').matchAll(
    /@(Query|Mutation)\([\s\S]*?name:\s*'([^']+)'/g,
  ),
].map((match) => `${match[1]}.${match[2]}`);

const BOUND = new Map<string, string>();
for (const spec of APP_HUB_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) BOUND.set(binding.identifier, spec.key);
}

describe('the Apps page resolver', () => {
  it('publishes the five operations — the reflection has to work for this suite to mean anything', () => {
    expect(OPERATIONS).toEqual([
      'Query.appHubLayouts',
      'Mutation.saveMyAppHubLayout',
      'Mutation.resetMyAppHubLayout',
      'Mutation.saveWorkspaceAppHubLayout',
      'Mutation.resetWorkspaceAppHubLayout',
    ]);
  });

  it('⚠ declares WORKSPACE scope on the class, so no operation can forget it', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, AppHubResolver)).toEqual({ level: 'workspace' });
  });

  it('marks nothing public', () => {
    const prototype = AppHubResolver.prototype as unknown as Record<string, object>;
    for (const name of Object.getOwnPropertyNames(prototype).filter((one) => one !== 'constructor')) {
      expect([name, Reflect.getMetadata(PUBLIC_SURFACE_METADATA, prototype[name] ?? {})]).toEqual([name, undefined]);
    }
  });

  it.each(OPERATIONS)('⚠ %s is bound to a key — an unbound one skips the membership check', (operation) => {
    expect(BOUND.get(operation)).toBeDefined();
  });

  it('⚠ binds the workspace default to the manage key, and a person’s own layout to read', () => {
    expect(BOUND.get('Mutation.saveWorkspaceAppHubLayout')).toBe(APP_HUB_FEATURE.layoutManage);
    expect(BOUND.get('Mutation.resetWorkspaceAppHubLayout')).toBe(APP_HUB_FEATURE.layoutManage);
    expect(BOUND.get('Mutation.saveMyAppHubLayout')).toBe(APP_HUB_FEATURE.read);
  });

  it('binds no operation that is not published', () => {
    expect([...BOUND.keys()].filter((operation) => !OPERATIONS.includes(operation))).toEqual([]);
  });

  it('sends one document per published operation', () => {
    expect(Object.keys(APP_HUB_OPERATIONS).sort()).toEqual(OPERATIONS.map((one) => one.split('.')[1]).sort());
  });
});
