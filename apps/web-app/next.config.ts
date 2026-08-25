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

const nextConfig: NextConfig = {
  transpilePackages: workspacePackages(),
};

export default nextConfig;
