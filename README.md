# kwtech-software

Turborepo monorepo, pnpm workspaces. Toolchain and conventions follow
`../masterdb-mgt-tool`; the full plan lives in **[docs/PLAN.md](docs/PLAN.md)**, and the reasoning behind
it in **[docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md)**. Building a feature? Start
with **[CLAUDE.md](CLAUDE.md)**: the working guide and checklist, which Claude
Code also loads on its own.

## Requirements

- Node >= 22
- pnpm >= 11 — `corepack enable` picks it up from the `packageManager` field.
  `.npmrc` sets `engine-strict=true`, so an older pnpm fails the install rather
  than producing a subtly different one.

## Layout

```
apps/
  web-server/         NestJS — REST today, GraphQL + WS in Phase 3   :8080
  web-app/            Next.js — web frontend                         :8081
packages/
  web-ui/             React + Tailwind 4 + AG Grid Community
  module-kit/         the module contract every app composes
  module-auth/        the authentication feature, whole
  module-permissions/ the permissions feature, whole
```

Feature modules ship as one package with a dependency-free core plus adapters
behind subpath exports — `@kwtech/module-permissions`, `.../server`, `.../react`.
Apps list their modules once and compose the rest:

```ts
export const WEB_MODULES = [permissionsWebModule, usersWebModule];
export const ROUTES = composeRoutes(WEB_MODULES);
```

See [packages/module-kit/README.md](packages/module-kit/README.md) for the
contract and [docs/PLAN.md](docs/PLAN.md) §9 before adding a module.

## Getting started

```bash
pnpm install
pnpm dev     # first run creates the `local` env profile, with fresh secrets
```

Then fill in `SEED_USER_*` (your sign-in) in `envs/local/web-server.env`.

### Environments: local, staging, production

Each environment is a **profile**: `envs/<name>/web-server.env` and
`envs/<name>/web-app.env`, gitignored. The active one is symlinked to
`apps/web-server/.env.local` and `apps/web-app/.env.local` (both apps use the
same file name), so switching is one
command and every tool (Nest, Next, Prisma, the seeders) follows it.

```bash
pnpm env:show            # active profile, its database and API (no secrets printed)
pnpm env:new staging     # create a profile from the templates, with fresh secrets
pnpm env:use staging     # switch both apps
pnpm db:deploy           # …now runs against staging
pnpm env:use local       # back
pnpm env:check           # templates hold no secrets; profiles lack no variable
```

- **Development defaults to `local`.** `pnpm dev` activates it and creates it the
  first time. A non-local profile prints a warning banner on every `pnpm dev`.
- **`APP_ENV` in each profile says what it is, and the guards trust it:**
  `db:migrate` and `db:snapshot` run only on local, and `db:restore` never
  touches production.
- **Deployed hosts don't use profile files.** Set the same variables in the host
  (Vercel, the container host), including `APP_ENV`. A production build refuses
  to boot without it.
- **`.env.example` files are templates committed to a public repo.** A value
  for any `*_PASSWORD`, `*_SECRET`, `*_KEY` or `*_EMAIL` fails the commit.
- Keep each profile in a password manager too. That's how a new machine gets
  them.

**On another machine**, including one with an old `apps/web-server/.env`: `git
pull && pnpm install && pnpm env:show` moves the old files into `envs/local/`
without losing anything, and `pnpm env:check` lists what's new. The full steps
for each case are in
[envs/README.md → Setting up another machine](envs/README.md#setting-up-another-machine).

`pnpm dev` starts **everything** — every package in watch mode plus both apps:

| | |
|---|---|
| API | http://localhost:8080/api/v1 |
| API docs (Swagger) | http://localhost:8080/api/v1/docs |
| Web | http://localhost:8081 |
| Sign in | http://localhost:8081/auth/signin |

Editing a `packages/*` file rebuilds it and the running apps pick the change up;
there is no separate build step while developing.

## Commands

```bash
pnpm dev              # everything: package watchers + both apps
pnpm dev:api          # just the API, and the packages it needs
pnpm dev:web          # just the frontend, and the packages it needs

pnpm build            # everything, in dependency order
pnpm start            # run the built apps
pnpm typecheck
pnpm test
pnpm lint             # biome — one tool, no eslint, no prettier
pnpm check:fix        # lint + format, writing fixes
```

Database (all scoped to `apps/web-server`, which owns the schema — PLAN §12.2):

```bash
pnpm --filter @kwtech/web-server db:compose    # copy module prisma fragments in
pnpm --filter @kwtech/web-server db:generate   # compose + generate the client
pnpm --filter @kwtech/web-server db:migrate    # compose + migrate dev
pnpm --filter @kwtech/web-server db:seed       # idempotent first user
pnpm --filter @kwtech/web-server db:snapshot   # dev data → seed-data/snapshot.json
pnpm --filter @kwtech/web-server db:restore    # seed-data/snapshot.json → empty database
pnpm --filter @kwtech/web-server db:studio
```

**Postgres** is expected where `DATABASE_URL` points, `localhost:5432` by
default. `pnpm dev` and `pnpm dev:api` run `scripts/dev-db.mjs` first: if
nothing answers on that port it starts a `kwtech-postgres` Docker container
(creating it the first time, with its data in the `kwtech-pgdata` volume), and
on a brand-new volume applies the migrations and seeds. A native Postgres
already on the port is used as-is.

```bash
pnpm db:up            # start (or create) the container without starting the apps
pnpm db:down          # stop it; the data stays in the volume
```

**Shared dev data.** `apps/web-server/seed-data/snapshot.json` is a committed
copy of a dev database's rows, so a second machine starts where the first left
off. A brand-new container restores it automatically; against a native
Postgres, or to catch up with a newer snapshot, run it yourself:

```bash
pnpm db:snapshot          # this database → snapshot.json (commit it)
pnpm db:restore           # snapshot.json → an empty, migrated database, then db:seed
pnpm db:restore --force   # the same, emptying the database first
```

The repository is public, so the snapshot carries **no credentials**: no
password hashes, MFA secrets, sessions or reset tokens. After a restore the
`SEED_USER_*` and `SEED_DEMO_USER_*` accounts sign in with the passwords in your
`.env`; any other account uses forgot-password, whose link is printed in the
API console while `SMTP_URL` is unset. Everything else in it — names, emails,
chat messages — is readable by anyone, so keep real customer data out of dev.

Docker Engine inside WSL2, once (`/etc/wsl.conf` needs `systemd=true`):

```bash
sudo apt update && sudo apt install -y docker.io
sudo usermod -aG docker $USER && sudo systemctl enable --now docker
# then open a new terminal so the group membership applies
```

## Conventions

- **Biome** is the only linter/formatter — no ESLint, no Prettier.
- Packages extend the root `tsconfig.base.json` directly; there is no
  `typescript-config` package.
- Shared dependency versions go in the pnpm `catalog:` in `pnpm-workspace.yaml`.
- `turbo.json` and `biome.jsonc` are JSONC — comment anything non-obvious.
- Conventional commits, enforced by lefthook + commitlint.
