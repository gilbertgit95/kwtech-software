import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { FILE_FEATURE, FILE_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { FILE_OPERATIONS } from '../src/operations.js';
import { FileResolver } from '../src/server/graphql/file.resolver.js';
import { FileTransferController } from '../src/server/http/file-transfer.controller.js';

/**
 * ⚠ THE §12.13 TRAP, TURNED INTO A RED BUILD — module-note's suite, for files.
 *
 *   - the resolver declares workspace scope, and nothing on it is public;
 *   - every operation it publishes is bound to a key;
 *   - no binding names an operation that does not exist;
 *   - the client's documents name exactly the published operations;
 *   - the two byte routes are public WITH a reason, and not credential surfaces.
 */
function publishedOperations(): string[] {
  const source = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', 'file.resolver.ts'), 'utf8');
  return [...source.matchAll(/@(Query|Mutation|Subscription)\([\s\S]*?name:\s*'([^']+)'/g)].map(
    (match) => `${match[1]}.${match[2]}`,
  );
}

const OPERATIONS = publishedOperations();

const BOUND = new Map<string, string>();
for (const spec of FILE_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) BOUND.set(binding.identifier, spec.key);
}

function handlers(target: { prototype: object }): Array<[string, object]> {
  const prototype = target.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .map((name) => [name, prototype[name] as object]);
}

describe('the files resolver', () => {
  it('publishes operations — the reflection has to work for this suite to mean anything', () => {
    expect(OPERATIONS.length).toBe(9);
  });

  it('⚠ declares WORKSPACE scope on the class', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, FileResolver)).toEqual({ level: 'workspace' });
  });

  it('marks nothing public, and nothing a credential surface', () => {
    for (const [name, handler] of handlers(FileResolver)) {
      expect([name, Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
      expect([name, Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
    }
  });

  it.each(OPERATIONS)('⚠ %s is bound to a key', (identifier) => {
    expect(BOUND.get(identifier)).toBeDefined();
  });

  it('binds settings to manage, sharing and uploads to write, and the rest to read', () => {
    expect(BOUND.get('Mutation.setFileSettings')).toBe(FILE_FEATURE.manage);
    expect(BOUND.get('Mutation.startFileUpload')).toBe(FILE_FEATURE.write);
    expect(BOUND.get('Mutation.deleteFile')).toBe(FILE_FEATURE.write);
    expect(BOUND.get('Mutation.issueFileDownload')).toBe(FILE_FEATURE.read);
    expect(BOUND.get('Subscription.fileEvents')).toBe(FILE_FEATURE.read);
  });

  it('⚠ name no operation that is not published', () => {
    expect([...BOUND.keys()].filter((identifier) => !OPERATIONS.includes(identifier))).toEqual([]);
  });
});

describe('the byte routes', () => {
  it('are public with a reason — the ticket is the authorisation — and never credential surfaces', () => {
    const routes = handlers(FileTransferController);
    expect(routes.map(([name]) => name).sort()).toEqual(['download', 'upload']);
    for (const [name, handler] of routes) {
      const reason = Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler) as string | undefined;
      expect([name, typeof reason === 'string' && reason.length > 20]).toEqual([name, true]);
      expect([name, Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
    }
  });
});

describe('the documents the client sends', () => {
  it('cover exactly the published operations', () => {
    const fields = Object.values(FILE_OPERATIONS).map((document) => {
      const match = /^\s*(query|mutation|subscription)\s+\w+[^{]*\{\s*(\w+)/.exec(document);
      const kind = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }[match?.[1] ?? 'query'];
      return `${kind}.${match?.[2]}`;
    });
    expect(fields.sort()).toEqual([...OPERATIONS].sort());
  });
});
