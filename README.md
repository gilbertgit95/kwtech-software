# kwtech-software

Turborepo monorepo, pnpm workspaces. Toolchain and conventions follow
`../masterdb-mgt-tool`; the full plan lives in **[docs/PLAN.md](docs/PLAN.md)**, and the reasoning behind
it in **[docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md)**.

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

# once: create the database, then apply migrations and seed the first user
createdb kwtech                       # or: sudo -u postgres createdb kwtech
cp apps/web-server/.env.example apps/web-server/.env      # set JWT_SECRET
cp apps/web-app/.env.example    apps/web-app/.env.local
pnpm --filter @kwtech/web-server db:migrate
pnpm --filter @kwtech/web-server db:seed

pnpm dev
```

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
pnpm --filter @kwtech/web-server db:studio
```

**Postgres** is expected on `localhost:5432`. On WSL2, `apt install postgresql`
is the simplest route — check `/etc/wsl.conf` has `systemd=true` first, or the
service will not survive a restart.

## Conventions

- **Biome** is the only linter/formatter — no ESLint, no Prettier.
- Packages extend the root `tsconfig.base.json` directly; there is no
  `typescript-config` package.
- Shared dependency versions go in the pnpm `catalog:` in `pnpm-workspace.yaml`.
- `turbo.json` and `biome.jsonc` are JSONC — comment anything non-obvious.
- Conventional commits, enforced by lefthook + commitlint.
