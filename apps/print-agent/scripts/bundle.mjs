// The print agent as one file, `dist/bundle/print-agent.mjs` (README, "Setting
// up a computer"), with this package's version stamped in (#215): the version
// changesets keeps equal to the product's, which the agent reports at pairing.
//
// A script rather than the old one-line esbuild command because the version
// has to be read from package.json, and a `--define` written inline in a
// package script quotes differently in every shell.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Installed beside the bundle: it carries SumatraPDF, a Windows program.
  external: ['pdf-to-printer'],
  outfile: 'dist/bundle/print-agent.mjs',
  logLevel: 'warning',
  define: { __KWTECH_AGENT_VERSION__: JSON.stringify(version) },
});
console.log(`print-agent.mjs bundled, version ${version}`);
