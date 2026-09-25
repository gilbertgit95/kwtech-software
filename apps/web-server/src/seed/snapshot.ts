import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../config/env.js';

/**
 * A copy of a dev database's DATA, committed, so another machine can pick the
 * work up where this one left off.
 *
 *   pnpm db:snapshot           this database → seed-data/snapshot.json
 *   pnpm db:restore            snapshot.json → an EMPTY, migrated database,
 *                              then `--phase=seed`
 *   pnpm db:restore --force    the same, truncating whatever is there first
 *
 * ## Why this is not a Seeder
 *
 * A seeder converges: it upserts by a natural key and can run on any database,
 * any number of times. A snapshot cannot. Its rows carry their own ids, and
 * `perm_role_feature`, memberships and grants point at those ids — so if the
 * sync seeders ran first and created `super-admin` under a fresh id, the
 * snapshot's `super-admin` would be skipped as a duplicate and every row that
 * references it would fail its foreign key. Restoring is a whole-database
 * operation on an empty database, and the seeders run AFTER it.
 *
 * ## What is left out, and why
 *
 * The repository is PUBLIC. Nothing that lets somebody sign in is exported —
 * see `EXCLUDED_TABLES` and `SCRUBBED_COLUMNS`. After a restore the accounts
 * exist with no password: `pnpm db:seed` (which restore runs) gives the
 * SEED_USER_* and SEED_DEMO_USER_* ones theirs, and any other account uses
 * forgot-password, whose link is logged to the console while SMTP_URL is unset.
 *
 * ## Schema drift
 *
 * Tables and columns are read from the database, never listed here, so a new
 * module's tables are included without touching this file. A restore inserts
 * only the columns the snapshot and the current table share: a column added by
 * a later migration takes its default, and one dropped since is ignored.
 */

const SNAPSHOT_PATH = fileURLToPath(new URL('../../seed-data/snapshot.json', import.meta.url));

/** Snapshot format version, bumped if the file's shape changes. */
const FORMAT = 1;

/** Tables never exported, and emptied by nothing but a forced restore. */
const EXCLUDED_TABLES: Record<string, string> = {
  _prisma_migrations: 'owned by `prisma migrate`; a restore requires it, never writes it',
  auth_credential: 'password hashes',
  auth_mfa_factor: 'TOTP secrets',
  auth_recovery_code: 'MFA recovery code hashes',
  auth_identity: 'federated sign-in subjects',
  auth_session: 'live refresh tokens',
  auth_password_reset: 'live reset tokens',
  queue_display_pass: 'live TV display credentials',
};

/**
 * Columns replaced on export by a SQL expression.
 *
 * An invitation's token hash is not itself a way in, but paired with the link
 * that was emailed it is one, and on a public repository there is no reason to
 * keep it. A random hash of the same shape keeps the NOT NULL + UNIQUE column
 * satisfied, and an old link simply stops matching.
 */
const SCRUBBED_COLUMNS: Record<string, Record<string, string>> = {
  perm_invitation: { tokenHash: `encode(sha256(gen_random_uuid()::text::bytea), 'hex')` },
};

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

async function tableNames(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return rows.map((row) => row.name);
}

async function columnNames(client: pg.ClientBase, table: string): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT column_name AS name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'
      ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((row) => row.name);
}

async function primaryKey(client: pg.ClientBase, table: string): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT a.attname AS name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)`,
    [quote(table)],
  );
  return rows.map((row) => row.name);
}

/** The newest migration applied here: the snapshot needs at least this schema. */
async function latestMigration(client: pg.ClientBase): Promise<string> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT migration_name AS name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name DESC LIMIT 1`,
  );
  if (!rows[0]) throw new Error('No migrations have been applied to this database. Run `pnpm db:deploy` first.');
  return rows[0].name;
}

/**
 * Tables ordered so every one comes after the tables its foreign keys point at.
 * There is no cycle today; one would be a schema problem and is reported as one.
 */
async function insertionOrder(client: pg.ClientBase, tables: string[]): Promise<string[]> {
  const { rows } = await client.query<{ child: string; parent: string }>(
    `SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
       FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`,
  );
  const unquote = (name: string) => name.replace(/^"(.*)"$/, '$1').replaceAll('""', '"');
  const parents = new Map(tables.map((table) => [table, new Set<string>()]));
  for (const { child, parent } of rows) {
    const [c, p] = [unquote(child), unquote(parent)];
    if (c !== p && parents.has(c) && parents.has(p)) parents.get(c)?.add(p);
  }

  const ordered: string[] = [];
  while (parents.size > 0) {
    const ready = [...parents].filter(([, needs]) => needs.size === 0).map(([table]) => table);
    if (ready.length === 0) throw new Error(`Foreign-key cycle between: ${[...parents.keys()].join(', ')}`);
    for (const table of ready) {
      ordered.push(table);
      parents.delete(table);
      for (const needs of parents.values()) needs.delete(table);
    }
  }
  return ordered;
}

async function exportSnapshot(client: pg.ClientBase) {
  const migration = await latestMigration(client);
  const tables = (await tableNames(client)).filter((table) => !(table in EXCLUDED_TABLES));

  /*
   * Written by hand, one row per line, from the text Postgres produced.
   *
   * One row per line so a re-export diffs as the rows that changed rather than
   * as a reflowed file. And never parsed in JS on the way out: a bigint column
   * past 2^53 would lose digits in a JSON.parse → JSON.stringify round trip.
   */
  const sections: string[] = [];
  let total = 0;
  for (const table of tables) {
    const scrub = SCRUBBED_COLUMNS[table] ?? {};
    const select = (await columnNames(client, table))
      .map((column) => (scrub[column] ? `${scrub[column]} AS ${quote(column)}` : quote(column)))
      .join(', ');
    const order = (await primaryKey(client, table)).map(quote).join(', ');
    const { rows } = await client.query<{ row: string }>(
      `SELECT row_to_json(r)::text AS row FROM (SELECT ${select} FROM ${quote(table)}${order ? ` ORDER BY ${order}` : ''}) r`,
    );
    total += rows.length;
    console.log(`  ${table.padEnd(28)} ${rows.length}`);
    const body = rows.map(({ row }) => `      ${row}`).join(',\n');
    sections.push(`    ${JSON.stringify(table)}: [${rows.length ? `\n${body}\n    ` : ''}]`);
  }

  const file = [
    '{',
    `  "format": ${FORMAT},`,
    `  "migration": ${JSON.stringify(migration)},`,
    `  "exportedAt": ${JSON.stringify(new Date().toISOString())},`,
    `  "tables": {\n${sections.join(',\n')}\n  }`,
    '}',
    '',
  ].join('\n');

  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, file);
  console.log(`\n${total} row(s) from ${tables.length} table(s) → ${SNAPSHOT_PATH}`);
  console.log(`Left out: ${Object.keys(EXCLUDED_TABLES).join(', ')}.`);
}

interface Snapshot {
  format: number;
  migration: string;
  tables: Record<string, Record<string, unknown>[]>;
}

function readSnapshot(): Snapshot {
  if (!existsSync(SNAPSHOT_PATH)) throw new Error(`No snapshot at ${SNAPSHOT_PATH}. Run \`pnpm db:snapshot\` first.`);
  /*
   * An integer too large for a double is kept as its source TEXT. It goes back
   * to Postgres as a JSON string, which json_populate_recordset parses with the
   * column's own type — so a bigint arrives with every digit.
   */
  const keepPrecision = (_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value) && context?.source
      ? context.source
      : value;
  const snapshot = JSON.parse(
    readFileSync(SNAPSHOT_PATH, 'utf8'),
    keepPrecision as (key: string, value: unknown) => unknown,
  ) as Snapshot;
  if (snapshot.format !== FORMAT) {
    throw new Error(`Snapshot format ${snapshot.format} is not ${FORMAT}. Re-export it with this version.`);
  }
  return snapshot;
}

async function restoreSnapshot(client: pg.ClientBase, force: boolean) {
  const snapshot = readSnapshot();

  const { rowCount } = await client.query(
    `SELECT 1 FROM _prisma_migrations
      WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    [snapshot.migration],
  );
  if (!rowCount) {
    throw new Error(
      `The snapshot was taken at migration ${snapshot.migration}, which this database has not applied.\n` +
        'Run `pnpm db:deploy` first.',
    );
  }

  const present = (await tableNames(client)).filter((table) => table !== '_prisma_migrations');
  const occupied: string[] = [];
  for (const table of present) {
    const { rowCount: rows } = await client.query(`SELECT 1 FROM ${quote(table)} LIMIT 1`);
    if (rows) occupied.push(table);
  }
  if (occupied.length > 0 && !force) {
    throw new Error(
      `This database already has data (${occupied.join(', ')}).\n` +
        'A snapshot restores into an empty database only. `pnpm db:restore --force` empties it first — ' +
        'every row in it, sessions included.',
    );
  }

  const tables = Object.keys(snapshot.tables).filter((table) => {
    if (present.includes(table)) return true;
    console.warn(`  ! ${table} is in the snapshot but not in this database — skipped`);
    return false;
  });

  await client.query('BEGIN');
  try {
    if (occupied.length > 0) {
      await client.query(`TRUNCATE ${present.map(quote).join(', ')} CASCADE`);
      console.log(`  emptied ${present.length} table(s)`);
    }

    let total = 0;
    for (const table of await insertionOrder(client, tables)) {
      const rows = snapshot.tables[table] ?? [];
      if (rows.length === 0) continue;

      const current = new Set(await columnNames(client, table));
      const shared = Object.keys(rows[0] ?? {}).filter((column) => current.has(column));
      const columns = shared.map(quote).join(', ');
      await client.query(
        `INSERT INTO ${quote(table)} (${columns})
         SELECT ${columns} FROM json_populate_recordset(NULL::${quote(table)}, $1::json)`,
        [JSON.stringify(rows)],
      );
      total += rows.length;
      console.log(`  ${table.padEnd(28)} ${rows.length}`);
    }
    await client.query('COMMIT');
    console.log(`\n${total} row(s) restored from ${snapshot.migration}.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--export') ? 'export' : argv.includes('--restore') ? 'restore' : null;
  if (!mode) throw new Error('Pass --export or --restore.');

  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    if (mode === 'export') await exportSnapshot(client);
    else await restoreSnapshot(client, argv.includes('--force'));
  } finally {
    await client.end();
  }

  if (mode === 'restore') {
    /*
     * Then the seeders, in their own process exactly as `pnpm db:seed` runs
     * them: sync brings the reference data up to what THIS checkout's code
     * declares, and the seed phase gives the SEED_USER_* accounts back the
     * passwords the snapshot deliberately does not carry.
     */
    console.log('\n▸ seeders');
    const run = fileURLToPath(new URL('./run.js', import.meta.url));
    const result = spawnSync(process.execPath, [run, '--phase=seed'], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
