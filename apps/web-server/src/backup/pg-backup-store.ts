import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { BackupFileEntry } from '@kwtech/module-backup';
import type { BackupStore } from '@kwtech/module-backup/server';

/** Where Postgres is, read from DATABASE_URL. The password never goes on a command line, where `ps` shows it. */
interface Connection {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  sslMode: string | null;
}

export interface PgBackupStoreConfig {
  databaseUrl: string;
  /** BACKUP_DIR, resolved against this app's directory when relative. */
  directory: string;
  /** BACKUP_DOCKER_CONTAINER: run the tools inside it. Null: the ones on the PATH. */
  dockerContainer: string | null;
  /** This app's directory, where `prisma migrate deploy` runs after a restore. */
  appDirectory: string;
}

/**
 * module-backup's `BackupStore`: the backup folder, and pg_dump / pg_restore
 * against this app's database (issue #2). Shared by the API (the Backups page,
 * the daily process) and the command line (`src/backup/cli.ts`), so there is
 * one way a backup is made.
 *
 * The parts of `scripts/db-backup.mjs` it keeps: Postgres's custom format
 * (`-Fc`, what pg_restore reads), a `.partial` name until pg_dump exits 0, and
 * running inside the dev container when there is one. What it adds: a database
 * that is not this machine's (the PATH's tools), and restore.
 */
export class PgBackupStore implements BackupStore {
  private readonly connection: Connection;
  private readonly directory: string;

  constructor(private readonly config: PgBackupStoreConfig) {
    this.connection = parseDatabaseUrl(config.databaseUrl);
    this.directory = resolve(config.appDirectory, config.directory);
  }

  database(): string {
    return this.connection.database;
  }

  /** The folder, for messages: where to look. */
  folder(): string {
    return this.directory;
  }

  async list(): Promise<BackupFileEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      // No folder yet is no backups yet, not a failure: the first backup makes it.
      if (isNotFound(error)) return [];
      throw error;
    }
    const entries: BackupFileEntry[] = [];
    for (const name of names) {
      // A dump still being written is not a backup.
      if (name.endsWith('.partial')) continue;
      const info = await stat(join(this.directory, name)).catch(() => null);
      if (info?.isFile()) entries.push({ name, sizeBytes: info.size, modifiedAt: info.mtime });
    }
    return entries;
  }

  async create(name: string): Promise<BackupFileEntry> {
    const target = this.inside(name);
    const partial = `${target}.partial`;
    await mkdir(this.directory, { recursive: true });
    try {
      await this.run(this.command('pg_dump', ['-Fc']), { stdoutTo: partial });
      // Every row, password hashes included: readable by the server's own user only.
      await chmod(partial, 0o600);
      await rename(partial, target);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
    const info = await stat(target);
    return { name, sizeBytes: info.size, modifiedAt: info.mtime };
  }

  async remove(name: string): Promise<boolean> {
    try {
      await rm(this.inside(name));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async open(name: string): Promise<{ stream: ReturnType<typeof createReadStream>; sizeBytes: number } | null> {
    const path = this.inside(name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return null;
    return { stream: createReadStream(path), sizeBytes: info.size };
  }

  /**
   * `--single-transaction`: every statement of the restore in one
   * transaction, so a failure halfway leaves the database exactly as it was.
   * `--clean --if-exists` drops what the backup recreates; `--no-owner` because
   * the roles of another machine need not exist here.
   *
   * ⚠ THEN `prisma migrate deploy`: a backup from an older version of the app
   * has an older schema, and this version would fail on its first query.
   */
  async restore(name: string): Promise<void> {
    const path = this.inside(name);
    await stat(path);
    await this.run(this.command('pg_restore', ['--clean', '--if-exists', '--no-owner', '--single-transaction']), {
      stdinFrom: path,
    });
    await this.run(
      { command: resolve(this.config.appDirectory, 'node_modules', '.bin', 'prisma'), args: ['migrate', 'deploy'] },
      { cwd: this.config.appDirectory },
    );
  }

  /** The tool, inside the container or from the PATH, pointed at this database. */
  private command(tool: 'pg_dump' | 'pg_restore', args: readonly string[]): Command {
    const { host, port, user, password, database, sslMode } = this.connection;
    if (this.config.dockerContainer) {
      // Inside the container the server is local: its socket, its own user, no password to pass.
      return {
        command: 'docker',
        args: ['exec', '-i', this.config.dockerContainer, tool, '-U', user, '-d', database, ...args],
      };
    }
    return {
      command: tool,
      args: ['-h', host, '-p', port, '-U', user, '-d', database, '--no-password', ...args],
      env: { PGPASSWORD: password, ...(sslMode ? { PGSSLMODE: sslMode } : {}) },
    };
  }

  /** Runs one tool to the end. A non-zero exit throws with the last of what it said. */
  private run(
    { command, args, env }: Command,
    io: { stdoutTo?: string; stdinFrom?: string; cwd?: string } = {},
  ): Promise<void> {
    return new Promise((done, fail) => {
      const child = spawn(command, args, {
        cwd: io.cwd,
        env: { ...process.env, ...env },
        stdio: [io.stdinFrom ? 'pipe' : 'ignore', io.stdoutTo ? 'pipe' : 'ignore', 'pipe'],
      });
      let said = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        said = `${said}${chunk.toString()}`.slice(-2000);
      });
      const piping: Promise<unknown>[] = [];
      if (io.stdoutTo && child.stdout) piping.push(pipeline(child.stdout, createWriteStream(io.stdoutTo)));
      if (io.stdinFrom && child.stdin) piping.push(pipeline(createReadStream(io.stdinFrom), child.stdin));
      child.on('error', (error) => fail(new Error(`${command} could not start: ${error.message}`)));
      child.on('close', (code) => {
        Promise.all(piping)
          .then(() => {
            if (code === 0) done();
            else fail(new Error(`${basename(command)} exited with ${code}: ${said.trim() || 'no message'}`));
          })
          .catch(fail);
      });
    });
  }

  /**
   * ⚠ The path of a name INSIDE the folder, or a throw. The module only passes
   * names it made, and this checks again: a bare file name, resolving under
   * the folder, never a path.
   */
  private inside(name: string): string {
    const path = resolve(this.directory, name);
    if (basename(name) !== name || !path.startsWith(`${this.directory}${sep}`)) {
      throw new Error(`Refused a backup name that is not a file in the backup folder: ${JSON.stringify(name)}`);
    }
    return path;
  }
}

interface Command {
  command: string;
  args: readonly string[];
  env?: Record<string, string>;
}

/** DATABASE_URL's parts. Prisma's own parameters (`?schema=public`) mean nothing to pg_dump and are dropped. */
export function parseDatabaseUrl(databaseUrl: string): Connection {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username || 'postgres'),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
    sslMode: url.searchParams.get('sslmode'),
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}
