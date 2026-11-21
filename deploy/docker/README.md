# kwtech in Docker, on a shop's own computer

The whole app on one shop computer with Docker Compose (#213, #133 P1):
Postgres, the API, the web app and HTTPS (Caddy). **Local hosting only.**

| Setup | Apps | Database | HTTPS |
|---|---|---|---|
| Development | native (`pnpm dev:focus`) | Docker (`pnpm db:up`) | Caddy via `pnpm https`, when needed |
| **A shop's own computer** | **Docker Compose** (this folder) | **Docker Compose** | **Caddy in Compose** |
| A real server | native, pm2 or the platform | managed or native Postgres | the host's, no Caddy |

Nothing outside this folder depends on it: development and a real-server
deploy stay as they are. On Windows, prepare the PC first with
[`deploy/windows/prepare-windows.ps1`](../windows/README.md).

## Files

| File | What it is |
|---|---|
| `compose.yml` | the four services, their volumes and health checks |
| `.env.example` | every setting, secrets empty; copy to `.env` |
| `Caddyfile.docker` | HTTPS: the pm2 setup's Caddyfile, pointed at the containers |
| `api.Dockerfile`, `api-entrypoint.sh` | the API image and its commands (`serve`, `first-setup`) |
| `web.Dockerfile` | the web app image (Next's standalone output) |
| `check-release.sh` | builds the images, boots them on an empty database, checks them |
| `../install.sh`, `../install.ps1` | the installer: settings and secrets, images, start, first setup (#133 P3) |
| `../kwtech` | the day-to-day command it installs: `status`, `logs`, `recover-account`, `certificate` |
| `../make-bundle.sh` | assembles the install bundle, for the release and for the Installer test |
| `compose.mac.yml`, `../mac/prepare-mac.sh`, `../install-mac.sh` | Apple Silicon Macs (#233): Colima, and ports published on the Mac's network address (Colima forwards `0.0.0.0` to the Mac's localhost only) |

## Running it

**At a shop, use the installer** (`deploy/install.ps1` on Windows,
`deploy/install.sh` on Linux, `deploy/install-mac.sh` on an Apple Silicon Mac, #233; the release's `kwtech-install-<version>.zip`),
which does all of this and the secrets, and [INSTALL.md](../INSTALL.md) is
the step-by-step guide. By hand:

```bash
cd deploy/docker
cp .env.example .env        # then fill it in: the address, the version, three secrets
docker compose up -d
docker compose run --rm api first-setup    # once, on a new install: the shop and its first people
```

Open `https://<the PC's address>`. Phones and other devices register the
shop's certificate from the Local network page, as in
[docs/HTTPS.md](../../docs/HTTPS.md) section 5.

- **On every start the API applies migrations and syncs the reference data**
  before it serves; a failed migration stops the start, loudly.
- **`first-setup`** (#206) asks for the organization, its first workspace,
  the super admin and a first person per role. It refuses on an install that
  is already set up. Pipe the answers in, one per line, when no one is typing.
- **Updating: `kwtech update`** (#133 P4). It backs up the database, the
  certificate authority and the settings first, runs the new release's own
  installer (checked against the release's `SHA256SUMS.txt`), and if the new
  version is not healthy, puts the old files and version back and restores
  the database when a migration ran. `--bundle DIR` and `--from-images FILE`
  update from a USB stick. By hand, without the safety: a new
  `KWTECH_VERSION` in `.env`, then `docker compose up -d`.

## What lives where

| Volume | Holds | Backed up |
|---|---|---|
| `db` | the database | by the app's daily 9 PM backup, into `backups` |
| `backups` | those backups (`BACKUP_DIR=/backups`, made with the image's own `pg_dump`) | copy them off the PC |
| `files` | uploaded files (#138) | no: temporary, the nightly clean-up deletes them |
| `caddy-data` | the shop's certificate authority, **with its private key** | yes, with the database: replacing the PC needs it (#133 P3) |
| `caddy-public` | only the authority's public `root.crt`, copied out by the Caddy container | no |

⚠ **The API never sees the authority's private key.** It mounts only
`caddy-public`, read-only, where Caddy copies `root.crt` every 30 seconds (the
authority is made on Caddy's first certificate, after it starts).

## Decided for a shop's own install

- **Settings fixed at build are the same for every shop.** The web image is
  built with Local network on and the realtime address as a path
  (`/api/v1/graphql`); everything that differs per shop comes from `.env`.
- **Email is optional** (`SMTP_URL` empty). The API's boot check allows it
  when `LOCAL_NETWORK=on`, and every mail sender refuses rather than logging a
  link in production, so no reset link lands in a log. A forgotten password is
  set again on the server PC (#133 P3, `recover-account`).
- **Billing on a shop's own copy is bookkeeping.** The shop owns the
  database, so its plan holds only as far as the shop is trusted: local
  installs are for trusted shops, with no check-in to a server of ours
  (#133, open decision 1, settled 2026-11-21).
- **`prisma` is a runtime dependency of the API**, not a dev one: applying
  migrations (`db:deploy`, the image's `serve`) is a deployment command.

## Moving from a pm2 install

Copy the old install's `.caddy/` folder into the `caddy-data` volume at
`kwtech/` (the storage root `KWTECH_CADDY_STORAGE=/data/kwtech`), before the
first `docker compose up`, and every phone keeps trusting the shop: the
authority is the same. Restore the database from a `pnpm db:backup` file with
the Backups page or `pg_restore` into the `db` service.

## The release check

```bash
deploy/docker/check-release.sh              # build, then check
deploy/docker/check-release.sh --no-build   # check the images already built
```

It runs under its own Compose project (`kwtech-check`) on ports 18080 and
18443 with secrets made for the run, so it never touches a real install. It
checks the API's health, the sign-in page, a GraphQL answer, the plain-HTTP
redirect and the certificate download, all through Caddy; runs `first-setup`
with piped answers and then that a second run is refused; and checks that
no env profile, `.caddy/` or test fixture is in the image. It removes its
containers and volumes at the end, passed or failed. #133 P2 runs it in CI.

It needs Docker Compose v2 (`docker compose`). Ubuntu's `docker.io` package
has none: `sudo apt install docker-compose-v2`.
