#!/usr/bin/env node
/**
 * `pnpm check:boundaries` (also the last step of `pnpm lint`) — the package
 * rules of PLAN §9 and CLAUDE.md, enforced rather than trusted to review.
 *
 * Each rule below was written down long before this file, and none was checked
 * by anything: `tsc` happily compiles a module that imports another module, and
 * the failure only shows up later — as two modules that cannot be adopted
 * apart, or as server code in the browser bundle. The map these rules protect
 * is in docs/DEPENDENCIES.md.
 *
 *   1. A `module-*` package imports, from `@kwtech/*`, only `@kwtech/module-kit`
 *      and `@kwtech/web-ui` (and itself). Never another module.
 *   2. `module-kit` and `web-ui` import no other `@kwtech` package.
 *   3. No package imports an app, or reaches into another package's `src/`.
 *   4. A module's `/react` code never imports its `/server` code — server code
 *      must stay out of the browser bundle.
 *   5. A module's pure core (`src/index.ts`, `src/domain/`, `src/types.ts`,
 *      `src/feature-keys.ts`, `src/operations.ts`) imports no framework.
 *   6. A module's package.json lists, among `@kwtech/*`, only `module-kit` and
 *      `web-ui`, in any dependency field.
 *
 * ⚠ Comments are skipped. Doc comments in this repo quote imports as examples
 * ("import { AuthModule } from '@kwtech/module-auth/server'"), and a checker
 * that read them as code would cry wolf until somebody stopped running it.
 *
 * No dependencies, so it runs before `pnpm install` has finished anything.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(ROOT, 'packages');

/** What a module may import from `@kwtech/*`, besides itself. */
const MODULE_MAY_IMPORT = new Set(['@kwtech/module-kit', '@kwtech/web-ui']);

/** Frameworks the pure core must not touch (rule 5). */
const FRAMEWORKS = [/^@nestjs\//, /^react(-dom)?(\/|$)/, /^next(\/|$)/, /^@prisma\//, /^graphql-ws(\/|$)/];

const SOURCE = /\.(ts|tsx|mts|mjs|js)$/;

/** Every source file under `dir`, skipping build output and dependencies. */
function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (SOURCE.test(entry) && !entry.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

/**
 * The module specifiers a file imports, with their line numbers — static
 * imports and re-exports, side-effect imports, `import()` and `require()`.
 * Lines inside comments are skipped (see the note at the top).
 */
function importsOf(file) {
  const found = [];
  let inBlock = false;
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('*')) continue;
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    const patterns = [
      /\bfrom\s+['"]([^'"]+)['"]/g,
      /^import\s+['"]([^'"]+)['"]/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) found.push({ specifier: match[1], line: index + 1 });
    }
  }
  return found;
}

/** `@kwtech/module-chat/server` → `@kwtech/module-chat`. */
function packageOf(specifier) {
  const [scope, name] = specifier.split('/');
  return scope?.startsWith('@') ? `${scope}/${name}` : scope;
}

const problems = [];
const report = (file, line, message) => problems.push(`${relative(ROOT, file)}:${line}  ${message}`);

for (const dir of readdirSync(PACKAGES)) {
  const packageDir = join(PACKAGES, dir);
  const manifestPath = join(packageDir, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    continue;
  }
  const self = manifest.name;
  const isModule = dir.startsWith('module-') && dir !== 'module-kit';
  const isFoundation = dir === 'module-kit' || dir === 'web-ui';

  // ── rule 6: the manifest ──────────────────────────────────────────────
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (!name.startsWith('@kwtech/')) continue;
      if (isFoundation) report(manifestPath, 1, `${field} lists ${name}: ${self} must depend on no @kwtech package`);
      else if (isModule && !MODULE_MAY_IMPORT.has(name)) {
        report(manifestPath, 1, `${field} lists ${name}: a module may depend only on module-kit and web-ui (PLAN §9)`);
      }
    }
  }

  const srcDir = join(packageDir, 'src');
  const files = [...sources(srcDir), ...(isModule ? safeSources(join(packageDir, 'test')) : [])];
  for (const file of files) {
    const inSrc = file.startsWith(srcDir + sep);
    const within = inSrc ? relative(srcDir, file).split(sep).join('/') : '';
    const isReact = within.startsWith('react/');
    const isPure =
      within === 'index.ts' ||
      within.startsWith('domain/') ||
      within === 'types.ts' ||
      within === 'feature-keys.ts' ||
      within === 'operations.ts';

    for (const { specifier, line } of importsOf(file)) {
      const pkg = packageOf(specifier);

      // ── rule 3: apps, and other packages' src ─────────────────────────
      if (pkg === '@kwtech/web-server' || pkg === '@kwtech/web-app' || /(^|\/)apps\//.test(specifier)) {
        report(file, line, `imports ${specifier}: packages never import an app`);
        continue;
      }
      if (pkg?.startsWith('@kwtech/') && /\/src(\/|$)/.test(specifier)) {
        report(file, line, `imports ${specifier}: import a package's public entry point, never its src/`);
        continue;
      }
      if (specifier.startsWith('.')) {
        const target = join(dirname(file), specifier);
        if (!target.startsWith(packageDir + sep)) {
          report(
            file,
            line,
            `imports ${specifier}: a relative path out of the package — import its public entry point`,
          );
          continue;
        }
        // ── rule 4: /react never reaches /server ──────────────────────
        if (isReact && relative(srcDir, target).split(sep)[0] === 'server') {
          report(
            file,
            line,
            `imports ${specifier}: /react must not import /server (server code in the browser bundle)`,
          );
        }
        continue;
      }

      // ── rules 1 and 2: @kwtech imports ────────────────────────────────
      if (pkg?.startsWith('@kwtech/') && pkg !== self) {
        if (isFoundation) report(file, line, `imports ${specifier}: ${self} must import no other @kwtech package`);
        else if (isModule && !MODULE_MAY_IMPORT.has(pkg)) {
          report(file, line, `imports ${specifier}: a module never imports another module — declare a port (PLAN §9)`);
        }
      }
      if (isReact && pkg === self && /\/server(\/|$)/.test(specifier)) {
        report(file, line, `imports ${specifier}: /react must not import /server (server code in the browser bundle)`);
      }

      // ── rule 5: the pure core ─────────────────────────────────────────
      if (isModule && isPure && FRAMEWORKS.some((framework) => framework.test(specifier))) {
        report(
          file,
          line,
          `imports ${specifier}: the pure core (index, domain, types, feature-keys, operations) imports no framework`,
        );
      }
    }
  }
}

function safeSources(dir) {
  try {
    return sources(dir);
  } catch {
    return [];
  }
}

if (problems.length > 0) {
  console.error(`✖ ${problems.length} package boundary violation(s) — see docs/DEPENDENCIES.md:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('✓ package boundaries hold (docs/DEPENDENCIES.md)');
