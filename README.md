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
  web-server/         NestJS — GraphQL + WS + REST
  web-app/            Next.js — web frontend
packages/
  web-ui/             React + Tailwind 4 + AG Grid Community
  module-kit/         the module contract every app composes
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

## Commands

```bash
pnpm install
pnpm dev              # all dev tasks
pnpm build
pnpm typecheck
pnpm lint             # biome check, per package
pnpm check:fix        # biome lint + format, whole repo, writes
pnpm db:migrate       # @kwtech/db
```

Every workspace package exposes the task names declared in `turbo.json`
(`build`, `dev`, `lint`, `typecheck`, `test`, `clean`) so `turbo run` sweeps them.

## Conventions

- **Biome** is the only linter/formatter — no ESLint, no Prettier.
- Packages extend the root `tsconfig.base.json` directly; there is no
  `typescript-config` package.
- Shared dependency versions go in the pnpm `catalog:` in `pnpm-workspace.yaml`.
- `turbo.json` and `biome.jsonc` are JSONC — comment anything non-obvious.
- Conventional commits, enforced by lefthook + commitlint.
