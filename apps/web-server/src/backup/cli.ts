/**
 * Backups from the command line (issue #2: "both on cli and ui"), on the
 * server, with the same store, names, limit and safety backup as the Backups
 * page — it builds the same `BackupService`, without Nest.
 *
 *   pnpm --filter @kwtech/web-server backup:create
 *   pnpm --filter @kwtech/web-server backup:list
 *   pnpm --filter @kwtech/web-server backup:restore <file> [--yes]
 *
 * ⚠ RESTORE: stop the API first (`pnpm pm2:stop`, or the dev server). The
 * page's restore holds every request off while it runs; from here nothing
 * does, and a request writing mid-restore is lost or breaks it. Afterwards
 * every session in the restored database is ended, so everybody signs in
 * again when the API is back.
 *
 * Asks for the database's name typed out, as the page does, unless `--yes`
 * (for a script that has already decided). No password: at the server's own
 * shell, the shell login is the proof the page's password stands in for.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { BACKUP_KIND_LABELS, formatBackupSize } from '@kwtech/module-backup';
import { BackupService, resolveBackupOptions } from '@kwtech/module-backup/server';
import { DEFAULT_TIME_ZONE } from '@kwtech/module-kit';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';
import { PrismaClient } from '../generated/client.js';
import { createBackupStore } from './backup-store.js';

async function main(): Promise<void> {
  const [command, name, ...flags] = process.argv.slice(2);
  const store = createBackupStore(env);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  const backups = new BackupService(
    resolveBackupOptions({ timeZone: env.BACKUP_TIME_ZONE ?? DEFAULT_TIME_ZONE, keep: env.BACKUP_KEEP }),
    store,
    // The shell is the authentication here; see the header.
    async () => true,
    // Every session in the restored rows ended. The API's in-memory denylist restarts with it.
    async () =>
      (await prisma.authSession.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } })).count,
  );

  try {
    switch (command) {
      case 'create': {
        const file = await backups.create(null, 'manual', new Date());
        console.log(`  ✓ ${file.name} (${formatBackupSize(file.sizeBytes)}) in ${store.folder()}`);
        console.log('    It holds every row, password hashes included. Keep it private.');
        if (flags.includes('--open') || name === '--open') reveal(join(store.folder(), file.name));
        return;
      }
      case 'list': {
        const { files, keep } = await backups.state();
        if (files.length === 0) console.log(`  No backups in ${store.folder()}.`);
        for (const file of files) {
          console.log(`  ${file.name}  ${formatBackupSize(file.sizeBytes)}  ${BACKUP_KIND_LABELS[file.kind]}`);
        }
        console.log(`  ${files.length} of ${keep} kept, in ${store.folder()}`);
        return;
      }
      case 'restore': {
        if (!name) throw new Error('Name the backup to restore: backup:restore <file> (backup:list shows them).');
        const database = store.database();
        if (!flags.includes('--yes')) {
          console.log(`  ⚠ This replaces the WHOLE database "${database}" with ${name}.`);
          console.log('    Everything since that backup is lost. A safety backup is made first.');
          console.log('    Stop the API before going on (pnpm pm2:stop, or the dev server).');
          const prompt = createInterface({ input: process.stdin, output: process.stdout });
          const typed = await prompt.question(`  Type ${database} to confirm: `);
          prompt.close();
          if (typed.trim() !== database) throw new Error('Not confirmed. Nothing was changed.');
        }
        await backups.restore('command-line', name, database, '', new Date());
        console.log(`  ✓ Restored ${name}. Everybody signs in again. Start the API: pnpm pm2:start`);
        return;
      }
      default:
        console.log('  Usage: backup:create | backup:list | backup:restore <file> [--yes]');
        process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Shows the new backup in the file manager — `pnpm db:backup`'s habit, kept —
 * through the repository's one helper, as `db:snapshot` does. Never fails the
 * backup, which is already written; skipped without a terminal or with
 * `--no-open`.
 */
function reveal(path: string): void {
  if (!process.stdout.isTTY || process.env.CI || process.argv.includes('--no-open')) return;
  const script = fileURLToPath(new URL('../../../../scripts/reveal.mjs', import.meta.url));
  if (!existsSync(script)) return;
  if (spawnSync(process.execPath, [script, path], { stdio: 'inherit' }).status !== 0) {
    console.warn('  Could not open the file manager.');
  }
}

main().catch((error: unknown) => {
  console.error(`  ✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
