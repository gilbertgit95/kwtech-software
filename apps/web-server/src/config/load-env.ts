import { existsSync } from 'node:fs';
import { config } from 'dotenv';

/**
 * Loads apps/web-server/.env.local, the same file name the Next app reads, so
 * both apps are configured the same way. `pnpm env:use` links the active
 * profile (envs/<name>/web-server.env) here.
 *
 * Relative to the working directory, which every `pnpm --filter
 * @kwtech/web-server …` script sets to this app. In deployment, where the values
 * are real environment variables, a missing file is a no-op, and an exported
 * variable always wins over the file.
 *
 * ⚠ The file used to be `.env`. A checkout that has not been migrated yet still
 * boots from it, with a warning, so pulling this change breaks nothing before
 * `pnpm env:show` (or `pnpm dev`) moves it.
 */
const legacy = !existsSync('.env.local') && existsSync('.env');
if (legacy) {
  console.warn('⚠ apps/web-server/.env is now .env.local. Run `pnpm env:show` once to migrate it.');
}
config({ path: legacy ? '.env' : '.env.local', quiet: true });
