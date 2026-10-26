import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { BACKUP_FEATURE, BACKUP_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { BACKUP_OPERATIONS } from '../src/operations.js';
import { BackupResolver } from '../src/server/graphql/backup.resolver.js';
import { BackupDownloadController } from '../src/server/http/backup-download.controller.js';

/**
 * ⚠ THERE IS NO `@RequireFeature` HERE: the registry's bindings ARE the guard,
 * so an unbound operation is a database backup — or a restore — reachable by
 * anybody signed in. Every operation is bound; the download route is public
 * and spends a ticket only the bound mutation gives out.
 */
function publishedOperations(): string[] {
  const source = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', 'backup.resolver.ts'), 'utf8');
  return [...source.matchAll(/@(Query|Mutation)\([\s\S]*?name:\s*'([^']+)'/g)].map(
    (match) => `${match[1]}.${match[2]}`,
  );
}

const OPERATIONS = publishedOperations();
const BOUND = new Map<string, string>();
for (const spec of BACKUP_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) BOUND.set(binding.identifier, spec.key);
}

function handler(target: { prototype: object }, name: string): object {
  return (target.prototype as Record<string, object>)[name] as object;
}

describe('the backup resolver', () => {
  it('publishes operations — the reflection has to work for this suite to mean anything', () => {
    expect(OPERATIONS).toHaveLength(5);
  });

  it('⚠ declares NO scope: every key is app level', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, BackupResolver)).toBeUndefined();
  });

  it.each(OPERATIONS)('⚠ %s is bound to a key', (identifier) => {
    expect(BOUND.get(identifier)).toBeDefined();
  });

  it.each([
    ['Query.backups', BACKUP_FEATURE.read],
    ['Mutation.createBackup', BACKUP_FEATURE.create],
    ['Mutation.issueBackupDownload', BACKUP_FEATURE.download],
    ['Mutation.deleteBackup', BACKUP_FEATURE.delete],
    ['Mutation.restoreBackup', BACKUP_FEATURE.restore],
  ])('%s → %s', (identifier, key) => {
    expect(BOUND.get(identifier)).toBe(key);
  });

  it('⚠ marks the restore — which takes a password — a credential surface, and nothing public', () => {
    expect(Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, handler(BackupResolver, 'restore'))).toBeTruthy();
    for (const name of ['state', 'create', 'remove', 'issueDownload', 'restore']) {
      expect([name, Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler(BackupResolver, name))]).toEqual([
        name,
        undefined,
      ]);
    }
  });

  it('has a document the page sends for every operation, and no other', () => {
    const sent = Object.values(BACKUP_OPERATIONS).map((document) => {
      const kind = document.trimStart().startsWith('mutation') ? 'Mutation' : 'Query';
      const field = /\{\s*(\w+)/u.exec(document)?.[1];
      return `${kind}.${field}`;
    });
    expect(sent.sort()).toEqual([...OPERATIONS].sort());
  });
});

describe('the download route', () => {
  it('⚠ is public with a stated reason, because the ticket is its authorisation', () => {
    const reason = Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler(BackupDownloadController, 'download'));
    expect(typeof reason).toBe('string');
    expect(reason.length).toBeGreaterThan(0);
  });
});
