import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { PRINT_AGENT_SECRET_HEADER, PRINT_JOB_TICKET_HEADER } from '../src/domain/jobs.js';
import { PRINT_FEATURE, PRINT_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { PRINT_OPERATIONS } from '../src/operations.js';
import { PrintResolver } from '../src/server/graphql/print.resolver.js';
import { PrintAgentResolver } from '../src/server/graphql/print-agent.resolver.js';
import { PrintRelayController } from '../src/server/http/print-relay.controller.js';

/**
 * ⚠ THE §12.13 TRAP, TURNED INTO A RED BUILD — and the public surface's twin.
 *
 * Every `print:*` key is workspace level. A resolver with no declared scope
 * resolves at app level, where no workspace key participates, and every key
 * grants nothing to everybody — with no error. And there is no `@RequireFeature`
 * here, so a missing BINDING is not a documentation gap but an unguarded
 * operation. This suite checks all of it:
 *
 *   - the PERSON's resolver declares workspace scope, nothing on it is public,
 *     and every operation on it is bound to a key;
 *   - the COMPUTER's resolver declares no scope, EVERYTHING on it is public
 *     with a reason, and only the operation that takes a guessable code is a
 *     credential surface;
 *   - no binding names an operation that does not exist, or a computer's;
 *   - the documents name exactly the published operations;
 *   - nothing on the GraphQL surface could carry a file;
 *   - the relay's two routes, which do carry one, are public with a reason,
 *     take no workspace, and are the only routes.
 */

const source = (name: string) => readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', name), 'utf8');
const PERSON_SOURCE = source('print.resolver.ts');
const AGENT_SOURCE = source('print-agent.resolver.ts');
const TYPES_SOURCE = source('print.types.ts');
const RELAY_SOURCE = readFileSync(join(__dirname, '..', 'src', 'server', 'http', 'print-relay.controller.ts'), 'utf8');

/** Read out of the resolver's SOURCE, as the queue's and the studio's suites do. */
function operationsIn(text: string): string[] {
  return [...text.matchAll(/@(Query|Mutation|Subscription)\([\s\S]*?name:\s*'([^']+)'/g)].map(
    (match) => `${match[1]}.${match[2]}`,
  );
}
const PERSON_OPERATIONS = operationsIn(PERSON_SOURCE);
const AGENT_OPERATIONS = operationsIn(AGENT_SOURCE);

const BOUND = new Map<string, string>();
for (const spec of PRINT_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) BOUND.set(binding.identifier, spec.key);
}

function handlers(resolver: { prototype: object }): Array<[string, object]> {
  const prototype = resolver.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .map((name) => [name, prototype[name] as object]);
}

/** The resolver's own helpers, which publish nothing. */
const PRIVATE_HELPERS = ['actor', 'admitted'];

describe('the person’s resolver', () => {
  it('publishes operations — the reflection has to work for this suite to mean anything', () => {
    expect(PERSON_OPERATIONS).toEqual([
      'Query.printAgents',
      'Mutation.createPrintPairingCode',
      'Mutation.revokePrintAgent',
      'Mutation.startPrintJob',
      'Query.printJob',
    ]);
  });

  it('⚠ declares WORKSPACE scope on the class, so no operation can forget it', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, PrintResolver)).toEqual({ level: 'workspace' });
  });

  it('marks nothing public, and nothing a credential surface', () => {
    for (const [name, handler] of handlers(PrintResolver)) {
      expect([name, Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
      expect([name, Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
    }
  });

  it.each(PERSON_OPERATIONS)('⚠ %s is bound to a key', (identifier) => {
    expect(BOUND.get(identifier)).toBeDefined();
  });

  it('binds the read to print:read, a job to print:send, and pairing and revoking to print:manage_agents', () => {
    expect(Object.fromEntries(BOUND)).toEqual({
      'Query.printAgents': PRINT_FEATURE.read,
      'Mutation.startPrintJob': PRINT_FEATURE.send,
      'Query.printJob': PRINT_FEATURE.send,
      'Mutation.createPrintPairingCode': PRINT_FEATURE.manageAgents,
      'Mutation.revokePrintAgent': PRINT_FEATURE.manageAgents,
    });
  });
});

describe('the computer’s resolver', () => {
  it('publishes its operations', () => {
    expect(AGENT_OPERATIONS).toEqual([
      'Mutation.pairPrintAgent',
      'Mutation.printAgentHeartbeat',
      'Mutation.reportPrintAgentPrinters',
      'Subscription.printAgentJobs',
      'Mutation.reportPrintAgentJob',
    ]);
  });

  it('⚠ declares NO scope: a workspace scope here would demand a member, and a computer is not one', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, PrintAgentResolver)).toBeUndefined();
  });

  it('⚠ marks EVERY operation public, with a reason', () => {
    const published = handlers(PrintAgentResolver).filter(([name]) => !PRIVATE_HELPERS.includes(name));
    expect(published).toHaveLength(AGENT_OPERATIONS.length);
    for (const [name, handler] of published) {
      const reason = Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler) as unknown;
      expect([name, typeof reason === 'string' && reason.trim().length > 0]).toEqual([name, true]);
    }
  });

  it('⚠ marks only the code exchange a credential surface — the one place a secret is guessed', () => {
    const credential = handlers(PrintAgentResolver)
      .filter(([, handler]) => Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, handler) !== undefined)
      .map(([name]) => name);
    expect(credential).toEqual(['pair']);
  });

  it('⚠ takes no workspace, organization or agent id: all three come from the admission', () => {
    const code = AGENT_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(/@Args\('(organizationId|workspaceId|agentId)'/.test(code)).toBe(false);
  });

  it('is bound to no key — a computer holds none', () => {
    expect(AGENT_OPERATIONS.filter((identifier) => BOUND.has(identifier))).toEqual([]);
  });
});

describe('the bindings', () => {
  it('⚠ name no operation that is not published by the person’s resolver', () => {
    expect([...BOUND.keys()].filter((identifier) => !PERSON_OPERATIONS.includes(identifier))).toEqual([]);
  });
});

describe('the GraphQL surface', () => {
  it('⚠ has no field that could carry a file', () => {
    // PLAN §13, 2026-10-07: a job's file crosses through the relay's two routes, as a stream. Nothing here may carry one.
    const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const text of [PERSON_SOURCE, AGENT_SOURCE, TYPES_SOURCE]) {
      expect(/upload|multipart|bytes|blob|base64/i.test(strip(text))).toBe(false);
    }
  });
});

describe('the relay’s two routes', () => {
  const routes = handlers(PrintRelayController);

  it('are the only ones, and carry the file and nothing else', () => {
    expect(routes.map(([name]) => name).sort()).toEqual(['fetch', 'send']);
    expect(Reflect.getMetadata('path', PrintRelayController)).toBe('print/jobs');
    for (const [, handler] of routes) expect(Reflect.getMetadata('path', handler)).toBe(':jobId/content');
  });

  it('⚠ are both public with a reason: a ticket admits the browser and a secret the computer', () => {
    for (const [name, handler] of routes) {
      const reason = Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler) as unknown;
      expect([name, typeof reason === 'string' && reason.trim().length > 0]).toEqual([name, true]);
    }
  });

  it('⚠ are not credential surfaces: both secrets are 256 random bits, and nothing is guessed', () => {
    for (const [name, handler] of routes) {
      expect([name, Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
    }
  });

  it('⚠ take no workspace or organization: the ticket names the job, and the secret the computer', () => {
    const code = RELAY_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(/organizationId|workspaceId/.test(code)).toBe(false);
  });

  it('⚠ never read the app’s own Authorization header', () => {
    expect(PRINT_AGENT_SECRET_HEADER.toLowerCase()).not.toBe('authorization');
    expect(PRINT_JOB_TICKET_HEADER.toLowerCase()).not.toBe('authorization');
  });
});

describe('the documents the clients send', () => {
  it('cover exactly the published operations, the web app’s and the agent’s', () => {
    const fields = Object.values(PRINT_OPERATIONS).map((document) => {
      const match = /^\s*(query|mutation|subscription)\s+\w+[^{]*\{\s*(\w+)/.exec(document);
      const kind = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }[match?.[1] ?? 'query'];
      return `${kind}.${match?.[2]}`;
    });
    expect(fields.sort()).toEqual([...PERSON_OPERATIONS, ...AGENT_OPERATIONS].sort());
  });
});
