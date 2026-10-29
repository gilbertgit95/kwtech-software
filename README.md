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
- Docker — `pnpm dev` runs the local Postgres in a container.
- On Windows, WSL2.

**New computer?** Follow **[docs/SETUP.md](docs/SETUP.md)**, from `git clone`
to signed in, with the database, seeding, optional services and
troubleshooting.

## Layout

```
apps/
  web-server/         NestJS — REST today, GraphQL + WS in Phase 3   :8080
  web-app/            Next.js — web frontend                         :8081
packages/
  web-ui/                 React + Tailwind 4 + AG Grid Community
  module-kit/             the module contract every app composes
  module-auth/            sign-in, sessions, MFA, password reset
  module-permissions/     organizations, workspaces, roles, features, plans, limits
  module-chat/            conversations and messages
  module-queuing-window/  walk-in queue: windows, lines, a live TV board
  module-notification/    system notifications: bell, toasts, an inbox
  module-jobs/            the background runner: queues and runs the processes modules declare; its admin page
  module-booking/         booking sub-app: services, resources and their hours, the day's bookings
```

No module imports another; only the apps depend on them. The map, and the
ports modules use instead, are in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md),
enforced by `pnpm check:boundaries`.

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
pnpm env:new local   # envs/local/, with fresh secrets
# fill in SEED_USER_* (your sign-in) in envs/local/web-server.env — BEFORE the first start
pnpm dev             # database created, migrated, filled and seeded; both apps running
```

Every step, and what each one does, is in [docs/SETUP.md](docs/SETUP.md).

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

That is one `tsc --watch` per package, about 300 MB each, which is heavy on a
machine with little memory: on WSL at its default size it runs out and WSL
goes down ([docs/SETUP.md](docs/SETUP.md), Troubleshooting, has the fix). When the work is in one or two packages, `pnpm dev:focus module-task`
(add more names, or `--api` / `--web`) runs the apps and watches only those.
Every other package is still built once at the start, but an edit to one of
them does not show up until you name it too or go back to `pnpm dev`.

`apps/print-agent` is left out of all of them, by a filter in the `dev` script:
it is developed on its own, against a server that is already running, and a
watcher for it would only cost memory here. Run it in a second terminal with
`pnpm dev:print-agent` (see [apps/print-agent/README.md](apps/print-agent/README.md)).
`pnpm start` leaves it out the same way, and `pnpm start:print-agent` runs the built
one.

## Commands

```bash
pnpm dev              # everything but the print agent: package watchers + both apps
pnpm dev:api          # just the API, and the packages it needs
pnpm dev:web          # just the frontend, and the packages it needs
pnpm dev:focus module-task   # both apps, watching ONLY the packages named (lighter)
pnpm dev:print-agent        # the print agent alone, rebuilt and restarted on edit (not part of pnpm dev)

pnpm build            # everything, in dependency order
pnpm start            # run the built apps (not the print agent)
pnpm start:print-agent      # build the print agent, then run it
pnpm typecheck
pnpm test
pnpm lint             # biome — one tool, no eslint, no prettier
pnpm check:fix        # lint + format, writing fixes
```

**In the background, under pm2.** `ecosystem.config.cjs` runs the API (:8080)
and the web app (:8081) from their built output as pm2 services, which keep
running after the terminal closes and come back if they crash. `pnpm pm2:start`
only starts what is already built. It does not build, start the database or
check the env profile, so do those first:

```bash
pnpm build            # once, and again after every change: nothing is watched
pnpm db:up            # if the database is the local Docker container
pnpm pm2:start        # start both, or reload them if they are already running
pnpm pm2:save         # remember what is running now; this is what comes back at boot
pnpm pm2:status       # are they online, and how often have they restarted
pnpm pm2:logs         # follow both logs (~/.pm2/logs/)
pnpm pm2:stop         # stop both and remove them from pm2
```

Each app reads its own `.env.local`, so the active profile (`pnpm env:show`)
decides what they connect to. Stop the pm2 services before `pnpm dev`, because
both use the same ports.

**Starting at boot** takes three things, each done once:

1. `pnpm exec pm2 startup` prints a `sudo env PATH=… pm2 startup systemd …`
   command. Run it to install a systemd service that starts pm2 at boot. It
   needs `systemd=true` in `/etc/wsl.conf`.
2. `pnpm pm2:start`, then `pnpm pm2:save`. At boot pm2 restores the last
   saved list, so a `pnpm pm2:stop` followed by a save leaves it empty. Boot
   runs the last build, never a new one.
3. **On WSL only**, Linux boots when something first opens WSL, not when
   Windows starts, and it shuts down when it has been idle for a while.
   Start it at logon with a hidden script in the Windows Startup folder
   (`shell:startup`, which needs no admin, unlike an `ONLOGON` scheduled task),
   `start-wsl-ubuntu.vbs`:
   `CreateObject("WScript.Shell").Run "wsl.exe -d Ubuntu --exec /bin/true", 0, False`.
   Keep it running with `vmIdleTimeout=-1` under `[wsl2]` in
   `%USERPROFILE%\.wslconfig`.

The Postgres container comes back at boot by itself: `scripts/dev-db.mjs`
creates it with `--restart unless-stopped`, and Docker is a systemd service.
The systemd service starts pm2 from this checkout's `node_modules`, so after
the repository moves, or after pm2 is upgraded, run step 1 again.

### HTTPS: the shop's network, a remote server

**[docs/HTTPS.md](docs/HTTPS.md)** is the guide: which setup you need,
first-time installation, registering each phone, tablet and computer, a
remote server, moving to another computer, and troubleshooting. In short:

| Where the app runs | HTTPS from | Devices |
|---|---|---|
| One computer, used only there (`http://localhost:8081`) | not needed | — |
| **The shop's network** (no domain) | **Caddy**, optional, with its own certificate authority: `pnpm https:setup`, then `pnpm build && pnpm pm2:start` (or `pnpm https` beside the dev servers) | each trusts the certificate once, from `http://<address>/kwtech-local-ca.crt` |
| **A remote server** with a domain | the host (platform, Cloudflare, nginx + Let's Encrypt) — **no Caddy** | nothing |

⚠ Any device other than the server itself needs `https://`: plain
`http://<address>:8081` crashes in the browser (no `crypto.randomUUID()` off
a secure page) and cannot stay signed in to the built app. Caddy runs only
when `FRONTEND_URL` is `https://` on a private address (`192.168.x.x`,
`10.x.x.x`, `172.16–31.x.x`); a domain never starts it.

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

**Dev data snapshot.** `pnpm db:snapshot` writes a scrubbed copy of a dev
database's rows to `apps/web-server/seed-data/snapshot.json`, which is
**gitignored**: the repository carries no data, and a fresh clone is seeded.
A brand-new container restores this machine's snapshot when there is one. To
move a whole database, credentials included, to another computer, use
`pg_dump` (docs/SETUP.md §7, "Moving a database to another computer").

```bash
pnpm db:backup            # a full pg_dump → backups/ (credentials included), for another computer
pnpm --filter @kwtech/web-server backup:list | backup:create | backup:restore <file>   # the app's backups, from the command line
pnpm db:snapshot          # this database → snapshot.json (stays on this machine)
pnpm db:restore           # snapshot.json → an empty, migrated database, then db:seed
pnpm db:restore --force   # the same, emptying the database first
```

The snapshot carries **no credentials**: no password hashes, MFA secrets,
sessions or reset tokens. After a restore the `SEED_USER_*` and
`SEED_DEMO_USER_*` accounts sign in with the passwords in your `.env`; any other
account uses forgot-password, whose link is printed in the API console while
`SMTP_URL` is unset. Keep real customer data out of dev all the same.

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
