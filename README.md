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

### HTTPS on the local network

Phones and tablets on the shop's Wi-Fi need **HTTPS**: the built app marks its
session cookies `Secure`, which a browser drops on plain `http://` anywhere but
`localhost` (so nobody could stay signed in), and installing the app on a phone
needs it too. ⚠ **Plain `http://192.168.x.x:8081` does not work from a phone,
even in development:** off `localhost` the page is not a secure context, so
the browser leaves out `crypto.randomUUID()`, which the app calls in a dozen
places (the phone layout's notifications crashed on it, and taking payment
would too), and live updates point at `wss://`. Use `https://<address>`. With no domain, **Caddy** sits in front of both apps on port 443
with a certificate from its **own local authority**, which each device trusts
once (`deploy/https/Caddyfile`, PLAN §13 2026-10-26).

```
https://<address>/api/v1/*  →  API :8080   (and the live-updates socket, wss://)
https://<address>/*         →  web app :8081
http://<address>/kwtech-local-ca.crt  →  the certificate, for phones to install
```

**Quick way:** install Caddy (step 2 below), then

```bash
pnpm https:setup        # finds this machine's address, writes the profile, checks Caddy
pnpm build && pnpm pm2:start && pnpm pm2:save
```

`pnpm https:setup` does steps 2's `setcap`, 4 and the check of the Caddyfile,
and prints what is left for THIS machine (the router, WSL's Windows settings,
each phone). `--address=192.168.1.186` skips the detection, `--yes` the
questions, and `--off` puts the profile back to plain `http://localhost`. Run
it again when the address changes. The steps it automates, by hand:

**Once, on the machine that serves the shop:**

1. **A fixed address.** On the router, reserve the server's address (a DHCP
   reservation, e.g. 192.168.1.186). The site's certificate names it, so a new
   address is a warning on every device until `pnpm https:setup` is run again
   — phones trust the AUTHORITY, so they need nothing new after that.
2. **Install Caddy** (2.8 or newer): `brew install caddy` on a Mac;
   `sudo apt install caddy` on Ubuntu/WSL (Caddy's own apt repository, see
   caddyserver.com/docs/install), then `sudo systemctl disable --now caddy` —
   pm2 runs it, not the system service — and
   `sudo setcap cap_net_bind_service=+ep "$(command -v caddy)"` so it may use
   ports 80 and 443 without root.
3. **On Windows with WSL only**, other devices reach Windows, not WSL: in
   `%USERPROFILE%\.wslconfig` set `networkingMode=mirrored` under `[wsl2]`
   (Windows 11), run `wsl --shutdown`, and allow ports 80 and 443 in through
   Windows Defender Firewall. The address is then the Windows PC's.
4. **The profile** (`envs/<name>/`, then `pnpm env:use <name>`):
   - `web-server.env`: `FRONTEND_URL="https://192.168.1.186"` — this is what
     turns HTTPS on.
   - `web-app.env`: `NEXT_PUBLIC_WS_URL="wss://192.168.1.186/api/v1/graphql"`.
     ⚠ Baked into the web app when it is BUILT: `pnpm build` again after
     changing it.
5. `pnpm build`, then `pnpm pm2:start`: pm2 runs a third service,
   `kwtech-https`. `pnpm pm2:save` so it comes back at boot.

**Once on each phone or tablet**, on the shop's Wi-Fi, open
`http://192.168.1.186/kwtech-local-ca.crt`:

- **iPhone / iPad:** allow the download, then Settings → *Profile Downloaded*
  → Install. Then Settings → General → About → **Certificate Trust Settings**
  → turn on **Caddy Local Authority**. Both steps are needed.
- **Android:** Settings → Security (or *Security & privacy* → *More*) →
  **Encryption & credentials** → Install a certificate → **CA certificate** →
  pick the downloaded file.
- **A Mac:** ⚠ double-clicking the file can fail with "Unable to import …
  Error: -25294" (the dialog picks a keychain it cannot write to). Instead,
  on the server itself:
  `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db .caddy/pki/authorities/local/root.crt`
  (macOS asks for the password), or on another Mac: Keychain Access → File →
  Import Items → the downloaded file, **Destination: login**, then open it →
  Trust → *Always Trust*. Quit and reopen the browser. Firefox has its own
  list: Settings → Privacy & Security → Certificates → Import.
- **Windows:** open the file → Install Certificate → *Local Machine* → *Place
  all certificates in the following store* → **Trusted Root Certification
  Authorities**.

Then open `https://192.168.1.186`. ⚠ The authority's private key is in
`.caddy/` (gitignored): copy it to a new server with the rest, or every device
must trust a new one. Google sign-in does not work on a bare address (Google
accepts only a real domain); passwords and two-step verification do.

**Running the built version** with HTTPS on (the pm2 section above, with
Caddy as a third service):

```bash
pnpm build && pnpm pm2:start   # first start, and after every change, pull or profile edit
pnpm pm2:save                  # keep all three for the next boot
pnpm pm2:status                # kwtech-web-server, kwtech-web-app and kwtech-https: online
pnpm pm2:logs kwtech-https     # Caddy's own log
pnpm pm2:stop                  # all three, e.g. before pnpm dev (same ports)
```

A new address (another network, a new router): `pnpm https:setup` again, then
`pnpm build && pnpm pm2:start`. The phones need nothing new: they trust the
authority in `.caddy/`, which signs a certificate for the new address too.
Turning it off: `pnpm https:setup --off`, then `pnpm build && pnpm pm2:start`.

**In development**, the same: set the two profile values, run `pnpm dev:focus
…` as usual and `pnpm https` in a second terminal (Ctrl+C stops it). Plain
`http://<address>:8081` keeps working in dev, because dev cookies are not
`Secure`; HTTPS there is for trying what a phone gets in production.

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
