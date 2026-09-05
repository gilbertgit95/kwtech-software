import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';
import { PrismaClient } from '../generated/client.js';
import { SEEDERS } from './seeders/index.js';
import type { Seeder, SeedPhase } from './types.js';

/**
 * The one entry point for every seeder, in every phase.
 *
 * ## What it replaces
 *
 * Two scripts chained in package.json with `&&`: two processes, two Prisma
 * clients, two connection pools, and an ordering that lived in a shell string.
 * A failure in the second left the database half-seeded with the shell simply
 * stopping, and nothing said which half.
 *
 * ## Phases
 *
 *   --phase=sync   reference data the code owns. Idempotent, runs on every
 *                  deploy. Until it has, a newly added feature key cannot be
 *                  granted to anyone.
 *   --phase=seed   sync FIRST, then the once-per-environment data — because
 *                  seed data references the reference data, and running seed
 *                  alone against a fresh database would fail on a foreign key.
 *
 * ## Flags
 *
 *   --list              print the seeders and exit, touching no database
 *   --only=a,b          run just these, by name, in list order
 *   --phase=sync|seed   default 'seed'
 */

function parseArgs(argv: readonly string[]) {
  const value = (flag: string) => argv.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);

  const phase = value('--phase') ?? 'seed';
  if (phase !== 'sync' && phase !== 'seed') {
    throw new Error(`Unknown --phase '${phase}'. Expected 'sync' or 'seed'.`);
  }

  return {
    list: argv.includes('--list'),
    phase: phase as SeedPhase,
    only: value('--only')
      ?.split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  };
}

/**
 * 'sync' runs the sync seeders. 'seed' runs those AND the seed ones — seed data
 * references reference data, so the second is never correct without the first.
 */
function select(phase: SeedPhase, only: string[] | undefined): Seeder[] {
  const inPhase = SEEDERS.filter((seeder) => (phase === 'sync' ? seeder.phase === 'sync' : true));
  if (!only) return inPhase;

  const unknown = only.filter((name) => !SEEDERS.some((seeder) => seeder.name === name));
  if (unknown.length > 0) {
    throw new Error(`Unknown seeder(s): ${unknown.join(', ')}. Run with --list to see them.`);
  }
  // Filtered from the ordered list rather than mapped from `only`, so a caller
  // cannot reorder dependent seeders by naming them in the wrong order.
  return inPhase.filter((seeder) => only.includes(seeder.name));
}

async function main() {
  const { list, phase, only } = parseArgs(process.argv.slice(2));

  if (list) {
    for (const seeder of SEEDERS) {
      console.log(`  ${seeder.phase.padEnd(5)} ${seeder.name.padEnd(28)} ${seeder.description}`);
    }
    return;
  }

  const selected = select(phase, only);
  if (selected.length === 0) {
    console.log(`Nothing to run for --phase=${phase}.`);
    return;
  }

  // ONE client for the whole run, closed once at the end.
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

  try {
    for (const seeder of selected) {
      console.log(`▸ ${seeder.name}`);
      /*
       * No transaction around the loop.
       *
       * Prisma's interactive transactions time out, and one spanning every
       * seeder would be exactly the long-lived transaction that does. What buys
       * safety instead is the idempotence every seeder is required to have: a
       * run that fails halfway is fixed by running it again, which is also what
       * the next deploy does anyway. A seeder needing atomicity across its own
       * writes opens its own transaction — see permissions:app-roles.
       */
      await seeder.run({ prisma, log: (message) => console.log(`  ${message}`) });
    }
    console.log(`\n${selected.length} seeder(s) complete.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
