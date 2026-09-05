// Prisma 7 moved the connection URL out of schema.prisma and stopped
// auto-loading .env — both are now this file's job. The schema stays purely
// declarative (shape only, no credentials), which is why it is safe to read and
// review in isolation, and why the module fragments composed into it need know
// nothing about where the database is.
//
// `dotenv/config` loads apps/web-server/.env relative to the working directory,
// so every `pnpm db:*` script picks it up. In deployment, where DATABASE_URL is
// a real environment variable, the missing .env is simply a no-op.
//
// Note this resolves env('DATABASE_URL') EAGERLY, so `prisma generate` needs
// the variable present even though it opens no connection — hence
// `passThroughEnv: ["DATABASE_URL"]` on the build task in turbo.json rather
// than `env`.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  migrations: {
    /*
     * Run after `prisma migrate reset` and `prisma migrate dev` create a fresh
     * database.
     *
     * It was not registered, so a reset dropped everything and re-seeded
     * nothing — leaving a schema with an EMPTY perm_feature, in which no role
     * can be granted anything because perm_role_feature references it. The
     * symptom was a working app that denied everyone, and the fix was a command
     * you had to know to run.
     *
     * `--phase=seed`, which runs the sync seeders first and then the
     * once-per-environment ones. That is right for a database that was just
     * dropped; a DEPLOY runs `pnpm db:sync` instead, which stops before
     * re-asserting anybody's account.
     */
    seed: 'pnpm db:seed',
  },
  // A folder, not a file: schema.prisma plus every module fragment that
  // scripts/compose-schema.mjs copied into prisma/_modules.
  schema: 'prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
