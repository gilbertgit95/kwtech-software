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
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const packages = join(app, '..', '..', 'packages');

/**
 * Every `@kwtech/module-*` dependency, DERIVED from package.json rather than
 * listed — the same trick, for the same reason, as `workspacePackages()` in the
 * web app's next.config.ts.
 *
 * It used to be a hand-kept array, which made adopting a module a dependency
 * PLUS an edit here that nothing would remind you about. Forgetting it does not
 * fail loudly: the module's tables simply never reach the schema, and the first
 * symptom is a migration that drops them or a query against a table that does
 * not exist.
 *
 * A module with no `prisma/` folder is skipped rather than treated as an error —
 * plenty of modules will declare no tables at all, and `@kwtech/module-kit` is
 * one of them today.
 */
function moduleDirectories() {
  const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));

  return Object.keys(manifest.dependencies ?? {})
    .filter((name) => name.startsWith('@kwtech/module-'))
    .map((name) => name.slice('@kwtech/'.length))
    .sort()
    .filter((dir) => existsSync(join(packages, dir, 'prisma')));
}

const MODULES = moduleDirectories();

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
