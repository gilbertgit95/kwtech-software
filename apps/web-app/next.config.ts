import { readFileSync } from 'node:fs';
import type { NextConfig } from 'next';

/**
 * Every `@kwtech/*` dependency, derived from package.json rather than listed.
 *
 * These packages ship TypeScript compiled to dist/, but their React
 * entrypoints carry 'use client' and JSX that Next must process itself for the
 * client/server boundary to be drawn correctly. Forgetting one does not fail
 * the build — it fails at render with "Element type is invalid", pointing
 * nowhere near the missing entry.
 *
 * Deriving it means adopting a module is a dependency and nothing else. A
 * hand-kept list is a second place to remember, and the whole point of the
 * module pattern is that there should not be one.
 */
function workspacePackages(): string[] {
  const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  return Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith('@kwtech/'));
}

/**
 * Addresses a phone on the same network may open the DEV server from.
 *
 * `next dev` answers its own script chunks with 403 for any origin but
 * `localhost`. A phone at `http://10.0.254.33:8081` then gets the page's HTML
 * and none of the chunks it loads later, so it looks right and nothing on it
 * works — no error a person would read, only a page that ignores taps.
 *
 * The private ranges, not one machine's address: a laptop's address changes
 * with the network it joins, and a hard-coded one would be wrong at the next
 * café. `*.local` is the Mac's own name on the network (`name.local`). Next
 * matches segment by segment, so `172.*.*.*` is wider than 172.16/12 —
 * harmless for a development server. Ignored entirely by `next build`/`start`.
 */
const LAN_DEV_ORIGINS = ['10.*.*.*', '192.168.*.*', '172.*.*.*', '*.local'];

const nextConfig: NextConfig = {
  transpilePackages: workspacePackages(),
  allowedDevOrigins: LAN_DEV_ORIGINS,
};

export default nextConfig;
