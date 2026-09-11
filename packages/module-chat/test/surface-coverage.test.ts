import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAT_FEATURE_REGISTRY } from '../src/feature-keys.js';

/**
 * ⚠ THE BINDINGS ARE THE GUARD in this module — there is no `@RequireFeature`,
 * because the decorator belongs to `module-permissions` and a module may not
 * import a module. So a missing binding is not a documentation gap, it is an
 * UNGUARDED MUTATION.
 *
 * This suite is the parity check the plan asked for: every operation the
 * resolver publishes is either bound to a key or named below as deliberately
 * unguarded, and nothing can be added without one of the two.
 */

/**
 * The operations that carry NO key, and why.
 *
 * Every one is the person's own remedy over their own participant row. §12.15
 * warns that an unguarded operation looks exactly like one that is deliberately
 * public — this list is what tells them apart, and the test below is what stops
 * a fourth arriving quietly.
 */
const DELIBERATELY_UNBOUND = new Set([
  // Withholding it would be a lockout dressed as a permission.
  'Mutation.leaveChat',
  // Answering an invitation addressed to you. Accepting still grants nothing
  // without chat:read.
  'Mutation.respondToChatInvitation',
  // The only remedy anybody has — §12.42 leaves the platform without one.
  'Mutation.setChatBlocked',
]);

/**
 * Read out of the resolver's SOURCE, not out of its decorator metadata.
 *
 * `@nestjs/graphql` keeps operation names in its own schema-building storage
 * rather than on `Reflect`, and reaching into that would tie this suite to an
 * internal of the library. The decorator call is the declaration either way,
 * and parsing it cannot drift from what is published: renaming an operation
 * renames it here.
 */
function publishedOperations(): string[] {
  const source = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', 'chat.resolver.ts'), 'utf8');
  const found: string[] = [];
  // `[\s\S]*?` rather than `[^)]*`: the decorator's first argument is a thunk
  // — `@Query(() => [ChatConversationType], { name: '...' })` — so stopping at
  // the first ')' finds nothing at all.
  for (const match of source.matchAll(/@(Query|Mutation)\([\s\S]*?name:\s*'([^']+)'/g)) {
    found.push(`${match[1]}.${match[2]}`);
  }
  return found;
}

const BOUND = new Map<string, string>();
for (const spec of CHAT_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) {
    if (binding.surface === 'graphql_operation') BOUND.set(binding.identifier, spec.key);
  }
}

describe('every chat operation is guarded or deliberately is not', () => {
  it('publishes operations at all — the reflection has to work for this suite to mean anything', () => {
    expect(publishedOperations().length).toBeGreaterThan(10);
  });

  it.each(publishedOperations())('%s', (identifier) => {
    const key = BOUND.get(identifier);
    if (DELIBERATELY_UNBOUND.has(identifier)) {
      // Naming it AND binding it would be two answers to one question.
      expect(key).toBeUndefined();
      return;
    }
    expect(key).toBeDefined();
  });

  it('⚠ binds no operation the resolver does not publish', () => {
    // The other direction, and the worse one: a binding naming a surface that
    // does not exist reads as coverage and enforces nothing.
    const published = new Set(publishedOperations());
    expect([...BOUND.keys()].filter((identifier) => !published.has(identifier))).toEqual([]);
  });

  it('guards deleting somebody else’s message with a DIFFERENT key from deleting your own', () => {
    expect(BOUND.get('Mutation.deleteChatMessage')).toBe('chat:send');
    expect(BOUND.get('Mutation.moderateChatMessage')).toBe('chat:moderate');
  });
});
