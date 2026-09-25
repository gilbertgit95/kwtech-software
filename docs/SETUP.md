# Setting up kwtech-software on a new computer

From an empty machine to the app running, signed in, with live data. Every
step is in order; follow them top to bottom the first time.

| Step | You end with |
|---|---|
| [1. Install the tools](#1-install-the-tools) | Git, Node 22+, pnpm 11+, Docker |
| [2. Get the code](#2-get-the-code) | the repository cloned |
| [3. Install dependencies](#3-install-dependencies) | `node_modules`, and the git hooks |
| [4. Create your environment](#4-create-your-environment) | `envs/local/` with secrets, and your sign-in |
| [5. Start everything](#5-start-everything) | the database created, migrated and filled; both apps running |
| [6. Sign in](#6-sign-in) | you, signed in as the platform administrator |
| [7. Working with the database](#7-working-with-the-database) | migrate, sync, seed, snapshot, restore, reset |
| [8. Everyday commands](#8-everyday-commands) | starting, stopping, checking before a commit |
| [9. Optional services](#9-optional-services) | Redis, email, Google sign-in, browser tests |
| [10. Troubleshooting](#10-troubleshooting) | fixes for the usual problems |

Coming from another machine you already set up? Read
[`envs/README.md` → Setting up another machine](../envs/README.md#setting-up-another-machine)
instead: it moves your existing files into place without losing anything.

---

## 1. Install the tools

| Tool | Version | Why |
|---|---|---|
| Git | any recent | the code, and the commit hooks |
| Node.js | **22 or newer** | both apps and every build |
| pnpm | **11 or newer** | the workspace. `.npmrc` sets `engine-strict=true`, so an older pnpm fails the install on purpose |
| Docker | any recent | the local Postgres database (`kwtech-postgres`) that `pnpm dev` starts for you |

**Windows:** work inside **WSL2** (Ubuntu), and run every command below in the
WSL terminal. The repository, Node, pnpm and Docker all live on the Linux side.

**Linux / WSL2:**

```bash
# Node 22 via nvm (or your package manager, if it has 22+)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
exec $SHELL
nvm install 22

# pnpm — corepack ships with Node and reads the version from package.json
corepack enable

# Docker
sudo apt update && sudo apt install -y docker.io
sudo usermod -aG docker $USER && sudo systemctl enable --now docker
# log out and back in (or `newgrp docker`) so the group applies
```

**macOS:** install Node 22 (`brew install node@22` or nvm), run
`corepack enable`, and install Docker Desktop.

Check:

```bash
node -v      # v22.x or newer
pnpm -v      # 11.x or newer
docker info  # prints server info, not an error
```

## 2. Get the code

```bash
git clone git@github.com:gilbertgit95/kwtech-software.git
cd kwtech-software
```

Cloning over SSH needs a key your GitHub account knows. If you have more than
one GitHub account, point git at the right key for this repository, for
example `GIT_SSH_COMMAND="ssh -i ~/.ssh/<your-key> -o IdentitiesOnly=yes" git push`.

## 3. Install dependencies

```bash
pnpm install
```

This installs every package in the workspace and, through the `prepare`
script, the **git hooks** (lefthook). From now on each commit:
- formats the staged files with Biome,
- refuses a secret in a committed `.env.example`,
- checks the message is a conventional commit (`feat(module-chat): …`).

## 4. Create your environment

Settings and secrets live in a **profile**: `envs/local/web-server.env` and
`envs/local/web-app.env`. Both are gitignored. The active profile is linked to
`apps/web-server/.env.local` and `apps/web-app/.env.local`, so every tool reads
it.

```bash
pnpm env:new local
```

That copies the two `.env.example` templates, **generates fresh secrets** (the
JWT signing key and the like), sets `APP_ENV="local"`, and activates the
profile. It then prints what is left for you to fill in.

**Now fill in your sign-in** in `envs/local/web-server.env`, BEFORE the first
`pnpm dev` (the first start seeds the database with it):

```bash
SEED_USER_NAME="Your Name"
SEED_USER_USERNAME="yourname"            # 3–32 of a-z 0-9 . - _
SEED_USER_EMAIL="you@example.com"
SEED_USER_PASSWORD="a-long-password"     # the app's password policy applies
SEED_SUPER_ADMIN_EMAIL="you@example.com" # optional: makes that account platform admin
```

Everything else already works for local development — the database URL points
at the Docker container `pnpm dev` starts, and the web app points at the API on
:8080. Optional services are in [section 9](#9-optional-services).

```bash
pnpm env:show     # which profile is active, its database and API — no secrets printed
pnpm env:check    # every variable the templates define is present in your profile
```

⚠ **Keep your profile in a password manager.** It is the one thing that is not
in git, and it is how your next machine gets it.

## 5. Start everything

```bash
pnpm dev
```

The first run does all of this, in order:

1. **Checks the environment** — activates `local` (creating it if you skipped
   step 4) and prints a warning banner if a non-local profile is active.
2. **Frees the ports** 8080 and 8081 if an old dev server holds them.
3. **Starts the database** — a Docker container `kwtech-postgres` (Postgres, on
   `localhost:5432`, data in the Docker volume `kwtech-pgdata`). If the volume
   is new it also:
   - applies every committed migration, then
   - **restores the committed dev data** (`apps/web-server/seed-data/snapshot.json`)
     and runs the seeders: features, roles, plans, defaults, and your account
     from `SEED_USER_*`.
4. **Builds and watches** every package, and starts both apps.

When it settles:

| | |
|---|---|
| Web app | http://localhost:8081 |
| Sign in | http://localhost:8081/auth/signin |
| API | http://localhost:8080/api/v1 |
| API docs (Swagger) | http://localhost:8080/api/v1/docs |
| GraphQL | http://localhost:8080/api/v1/graphql |

Editing a `packages/*` file rebuilds it and the running apps pick the change up;
there is no separate build step while developing.

## 6. Sign in

Open http://localhost:8081/auth/signin and sign in with `SEED_USER_EMAIL` (or
`SEED_USER_USERNAME`) and `SEED_USER_PASSWORD`. With `SEED_SUPER_ADMIN_EMAIL`
set to the same address you are the platform administrator: every
Administration page is yours.

Other accounts in the restored data have **no password** — the snapshot never
contains credentials. To use one, go to "Forgot password": with no `SMTP_URL`
set, the reset link is printed in the `pnpm dev` output instead of emailed.

To see notifications working straight away:

```bash
pnpm --filter @kwtech/web-server notify:demo --to=you@example.com
```

## 7. Working with the database

The schema is owned by `apps/web-server`; each module ships a fragment of it
(`packages/module-*/prisma/*.prisma`) that the scripts compose.

| Command | What it does | When |
|---|---|---|
| `pnpm db:up` / `pnpm db:down` | start / stop the `kwtech-postgres` container | `pnpm dev` does `up` for you |
| `pnpm db:migrate` | compose the module fragments, then `prisma migrate dev` — creates and applies a migration for a schema change. **Local profile only.** | after changing any `*.prisma`; commit the migration folder |
| `pnpm db:generate` | compose + regenerate the Prisma client | after pulling someone else's schema change |
| `pnpm db:sync` | reference data the CODE owns: feature keys, app roles, defaults. Idempotent | after adding a feature key, and on every deploy |
| `pnpm db:seed` | `db:sync` plus once-per-environment data: plans, your account from `SEED_USER_*` (⚠ this RESETS its password to `SEED_USER_PASSWORD`), the optional demo user | first setup, or to reset your password |
| `pnpm db:snapshot` | export the dev data to `seed-data/snapshot.json`. **Local only.** Credentials, sessions and codes are left out | to share dev data through git |
| `pnpm db:restore [--force]` | load the snapshot into an empty, migrated database, then run the seeders. `--force` empties it first. Never against production | to reset to the shared data |
| `pnpm db:studio` | Prisma Studio, a browser UI over the tables | to look at data |
| `pnpm db:deploy` | apply committed migrations, no new ones | deploys |

**After `git pull`** with someone else's schema change: `pnpm install`, then
`pnpm db:migrate` (applies the new migrations locally), then `pnpm db:sync` if
feature keys changed. `pnpm dev` then starts as usual.

**Start the database over from scratch:**

```bash
pnpm dev:stop
docker rm -f kwtech-postgres && docker volume rm kwtech-pgdata
pnpm dev          # a new volume: migrate + restore + seed, as on the first run
```

⚠ `envs/local/` is never touched by any of this. Before running anything that
writes to a database, `pnpm env:show` tells you which one you are pointed at.

## 8. Everyday commands

```bash
pnpm dev                 # everything
pnpm dev:api             # database + API only (and the packages it needs)
pnpm dev:web             # web app only
pnpm dev:stop            # free :8080 / :8081
pnpm dev:ports           # what holds them

pnpm typecheck           # every package and app
pnpm test                # every unit test (no database needed)
pnpm lint                # Biome, then the package boundary check
pnpm check:fix           # let Biome fix formatting and imports
pnpm build               # production builds
```

**Before calling work done**, `pnpm typecheck`, `pnpm test` and `pnpm lint`
must pass — and when the change can be seen, run the app too: some failures
(a GraphQL schema error, a duplicate Nest module) only happen at boot.

Commits are conventional and scoped by package directory:
`feat(module-notification): …`, `fix(web-server): …`, `docs: …`. See
[`CLAUDE.md`](../CLAUDE.md) for the add-a-feature checklist and
[`docs/DEPENDENCIES.md`](DEPENDENCIES.md) for what may import what.

## 9. Optional services

All of these are off by default; the app works without each one, and the table
says what you lose.

| Service | Without it | To turn it on (in `envs/local/web-server.env` unless noted) |
|---|---|---|
| **Redis** | realtime works on one API process. A separate process (like `notify:demo`) cannot reach the server's sockets | `docker run -d --name kwtech-redis -p 6379:6379 redis:7`, then `REDIS_URL="redis://localhost:6379"` |
| **Email (SMTP)** | reset links, invitations and codes are printed in the `pnpm dev` output | a local catcher: `docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit`, then `SMTP_URL="smtp://localhost:1025"`; read mail at http://localhost:8025 |
| **Google sign-in** | the Google button is hidden | set all three: `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET`, `AUTH_GOOGLE_REDIRECT_URI` (half-configured refuses to boot) |
| **A demo user** | — | `SEED_DEMO_USER_*`, then `pnpm db:seed --only=demo:user` |
| **Browser (e2e) tests** | — | see [`apps/web-app/e2e/README.md`](../apps/web-app/e2e/README.md): `playwright install chromium`, its system libraries (needs `sudo`), and the `E2E_*` variables |

Restart `pnpm dev` after changing a profile.

**Other environments** (staging, production) are profiles too:
`pnpm env:new staging`, `pnpm env:use staging`, and back with
`pnpm env:use local`. See [`envs/README.md`](../envs/README.md). Deployed hosts
set the same variables in the host instead of using profile files.

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `pnpm install` fails on the engine | Node or pnpm is too old: `node -v` ≥ 22, `corepack enable`, `pnpm -v` ≥ 11 |
| `pnpm dev` says Docker is missing or not running | install it (step 1), or `sudo systemctl enable --now docker`; on WSL make sure the daemon is running in WSL |
| `docker: permission denied` | `sudo usermod -aG docker $USER`, then log out and in |
| `✗ db:restore failed on the new database` with `SEED_USER_EMAIL is required` | the sign-in was not filled before the first start. Fill `SEED_USER_*` (step 4), then `pnpm db:seed` |
| Port 8080/8081/5432 already in use | `pnpm dev:stop` frees 8080/8081; for 5432 stop the other Postgres |
| Sign-in fails for your account | `pnpm db:seed` sets its password to `SEED_USER_PASSWORD` again |
| The API fails to boot on a missing or invalid variable | it names the variable; `pnpm env:check` lists what your profile lacks next to the templates |
| Errors about a table or column that does not exist | the database is behind the code: `pnpm db:migrate` (then `pnpm db:sync`) |
| A page refuses you ("not available to you") | your roles lack the key. Set `SEED_SUPER_ADMIN_EMAIL` to your address and `pnpm db:seed`, or grant a role in Administration |
| The notification bell shows a grey or amber dot | the live connection is down or reconnecting — is the API running? "Retry now" in the bell reconnects at once |
| A package change does not show up | the watcher may have stopped: restart `pnpm dev` (or `pnpm build` the package) |
| Everything is strange | start the database over (section 7), and `pnpm install` again |
