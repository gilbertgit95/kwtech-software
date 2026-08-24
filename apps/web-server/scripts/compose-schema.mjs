/**
 * Composes every module's Prisma fragment into this app's schema.
 *
 * PLAN §9: a module owns its models and ships them as a `.prisma` fragment;
 * composition is a FILE-level dependency, not a package one, because a package
 * import in that direction would close a cycle — the app's schema depends on
 * the module, and the module must never depend on a db package.
 *
 * The fragments are copied rather than imported: `prisma migrate` diffs whole
 * schema directories, so what is on disk has to be the whole truth. Copies land
 * in prisma/_modules/, which is gitignored and rebuilt on every generate — a
 * checked-in copy would be a second source that drifts.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const packages = join(app, '..', '..', 'packages');

/** Add a line here when the app adopts a new module. Nothing else changes. */
const MODULES = ['module-auth', 'module-permissions'];

const target = join(app, 'prisma', '_modules');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

const copied = [];
for (const name of MODULES) {
  const from = join(packages, name, 'prisma');
  for (const file of readdirSync(from).filter((f) => f.endsWith('.prisma'))) {
    copyFileSync(join(from, file), join(target, file));
    copied.push(`${name}/prisma/${file}`);
  }
}

writeFileSync(
  join(target, 'README.md'),
  `# Generated — do not edit\n\nCopied by scripts/compose-schema.mjs from:\n\n${copied
    .map((f) => `- \`packages/${f}\``)
    .join('\n')}\n\nEdit the fragment in its module and re-run \`pnpm db:compose\`.\n`,
);

console.log(`Composed ${copied.length} module schema fragment(s):\n${copied.map((f) => `  ${f}`).join('\n')}`);
