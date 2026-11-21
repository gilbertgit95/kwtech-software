#!/usr/bin/env node
/**
 * The product's ONE version (#204), read from the workspace packages that
 * changesets keeps in step (`.changeset/config.json`, one `fixed` group).
 *
 *   node scripts/release-version.mjs          prints it (`1.5.0`)
 *   node scripts/release-version.mjs sync     copies it to the root package.json
 *   node scripts/release-version.mjs check    fails when the packages disagree
 *   node scripts/release-version.mjs notes    writes the next version's release notes to CHANGELOG.md
 *   node scripts/release-version.mjs notes --print <version>   prints that version's notes (the GitHub release body)
 *
 * ## Why the root is copied by hand
 *
 * The root `package.json` is not a workspace package (pnpm-workspace.yaml
 * lists `apps/*` and `packages/*`), so `changeset version` never touches it.
 * Left alone it says `0.0.0` forever beside packages on `1.5.0`, and the first
 * place anybody looks for "which version is this" would be wrong.
 *
 * ## Why one CHANGELOG.md, written here
 *
 * Changesets writes a changelog per PACKAGE: 24 files, most saying only
 * "Updated dependencies", for a product a shop updates as one thing. Its own
 * changelogs are off (`changelog: false`), and `notes` writes ONE section to
 * the root CHANGELOG.md from the pending changesets, BEFORE `changeset
 * version` consumes them (`pnpm changeset:version` runs the two in that
 * order). The version comes from `changeset status`, the same calculation
 * `changeset version` then applies.
 *
 * ## Why `check` exists when the group is fixed
 *
 * A fixed group only keeps versions together for packages it RELEASES. A
 * package added later starts at whatever its package.json says, and a hand
 * edit can move one alone. The release workflow tags the version this script
 * prints, so two answers would tag a release that half the packages do not
 * carry: it refuses instead, naming them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WORKSPACE_DIRS = ['apps', 'packages'];

/** Every workspace package: its directory, name and version. */
function workspacePackages() {
  const found = [];
  for (const dir of WORKSPACE_DIRS) {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(ROOT, dir, entry.name, 'package.json');
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        // A folder without a package.json is not a package (a stray build output, say).
        continue;
      }
      found.push({ path: `${dir}/${entry.name}`, name: manifest.name, version: manifest.version });
    }
  }
  return found;
}

/** The one version, or an error naming every package that disagrees. */
function productVersion() {
  const packages = workspacePackages();
  const versions = new Map();
  for (const pkg of packages) {
    const list = versions.get(pkg.version) ?? [];
    list.push(pkg.path);
    versions.set(pkg.version, list);
  }
  if (versions.size === 1) return [...versions.keys()][0];
  const lines = [...versions.entries()].map(([version, paths]) => `  ${version}: ${paths.join(', ')}`);
  throw new Error(
    `The packages do not share one version, so there is no product version to release:\n${lines.join('\n')}\n` +
      'Every @kwtech/* package is in one fixed group (.changeset/config.json); set the odd ones to the version most share.',
  );
}

/** The release notes' headings, by the largest bump a changeset asked for. Words for a shop, not semver. */
const SECTIONS = [
  { type: 'major', heading: 'Needs your attention' },
  { type: 'minor', heading: 'New' },
  { type: 'patch', heading: 'Fixed' },
];
const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

/** The day of `now` in the shops' zone, `YYYY-MM-DD`: never UTC, which dates an evening release a day early. */
function releaseDay(now) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

/** What `changeset status` would release: the next version and the pending changesets. */
function pendingRelease() {
  const dir = mkdtempSync(join(tmpdir(), 'kwtech-release-'));
  const file = join(dir, 'status.json');
  try {
    execFileSync(join(ROOT, 'node_modules/.bin/changeset'), ['status', '--output', file], { cwd: ROOT, stdio: 'pipe' });
    return JSON.parse(readFileSync(file, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One version's section: a heading, then each changeset's sentence under the largest bump it asked for. */
function notesSection(version, changesets, day) {
  const lines = [`## ${version} (${day})`, ''];
  let any = false;
  for (const section of SECTIONS) {
    const items = changesets.filter((changeset) => {
      const largest = changeset.releases.reduce((top, release) => Math.max(top, RANK[release.type] ?? 0), 0);
      return changeset.summary.trim() !== '' && largest === RANK[section.type];
    });
    if (items.length === 0) continue;
    any = true;
    lines.push(`### ${section.heading}`, '');
    for (const item of items) lines.push(`- ${item.summary.trim().replace(/\n+/g, ' ')}`);
    lines.push('');
  }
  // Only empty changesets (tests, CI, refactors): say so, rather than a heading over nothing.
  if (!any) lines.push('Maintenance only: nothing changes for the people using the app.', '');
  return lines.join('\n');
}

const CHANGELOG = join(ROOT, 'CHANGELOG.md');
const CHANGELOG_HEAD =
  '# Changelog\n\nkwtech, one version for the API, the web app, the print agent and every module (#204).\n\n';

/** Writes the next version's section at the top of CHANGELOG.md. */
function writeNotes() {
  const status = pendingRelease();
  const versions = new Set(status.releases.map((release) => release.newVersion));
  if (versions.size === 0) throw new Error('No changesets are pending, so there is nothing to release.');
  if (versions.size > 1) {
    throw new Error(
      `The pending release would give the packages different versions (${[...versions].join(', ')}). Check the fixed group in .changeset/config.json.`,
    );
  }
  const [version] = versions;
  const section = notesSection(version, status.changesets, releaseDay(new Date()));
  const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8') : CHANGELOG_HEAD;
  const body = existing.startsWith(CHANGELOG_HEAD) ? existing.slice(CHANGELOG_HEAD.length) : existing;
  writeFileSync(CHANGELOG, `${CHANGELOG_HEAD}${section}\n${body}`);
  console.log(`CHANGELOG.md: notes for ${version}.`);
}

/** Prints one version's section from CHANGELOG.md, for the GitHub release. */
function printNotes(version) {
  if (!version) throw new Error('Say which version: notes --print 1.5.0');
  const text = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8') : '';
  const start = text.indexOf(`## ${version} (`);
  if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  const next = text.indexOf('\n## ', start + 1);
  const section = text.slice(start, next === -1 ? undefined : next).trim();
  // The heading is the release's title on GitHub already.
  console.log(section.split('\n').slice(1).join('\n').trim());
}

function main() {
  const command = process.argv[2] ?? 'print';
  if (command === 'notes') {
    if (process.argv[3] === '--print') printNotes(process.argv[4]);
    else writeNotes();
    return;
  }
  const version = productVersion();
  if (command === 'print') {
    console.log(version);
    return;
  }
  if (command === 'check') {
    console.log(`✓ every package is on ${version}`);
    return;
  }
  if (command === 'sync') {
    const file = join(ROOT, 'package.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    if (manifest.version === version) return;
    manifest.version = version;
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Root package.json set to ${version}.`);
    return;
  }
  throw new Error(`Unknown command "${command}". Say nothing (print), sync, check or notes.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
