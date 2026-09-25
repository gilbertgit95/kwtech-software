# envs/: environment profiles

Everything in this folder except this README is gitignored. It holds real
secrets.

```
envs/local/web-server.env        linked to apps/web-server/.env.local
envs/local/web-app.env           linked to apps/web-app/.env.local
envs/staging/…
envs/production/…
```

```bash
pnpm env:show            # the active profile, its database and API (no secrets printed)
pnpm env:use staging     # switch BOTH apps to staging
pnpm env:new staging     # create a profile from the .env.example files, with fresh secrets
pnpm env:check           # templates hold no secrets; profiles lack no variable
```

- **Development defaults to `local`.** `pnpm dev` activates it, and creates it
  the first time.
- **`APP_ENV` in each profile says what the profile is**, and the guards trust
  it: `db:migrate` and `db:snapshot` run only on `local`, and `db:restore`
  refuses `production`.
- **Deployed staging and production hosts don't use these files.** Set the same
  variables in the host's secret settings (Vercel, the container host). A
  production build refuses to boot without `APP_ENV`. The staging and production
  profiles here are for running commands from this machine against those
  databases (`pnpm db:deploy`, `pnpm db:sync`) and as the record of what the
  host was given.

## Setting up another machine

Pick the case that matches the machine.

### A. It already has `apps/web-server/.env`

This covers both a plain `.env` from before profiles and a `.env` link from
before the rename to `.env.local`.

```bash
git pull
pnpm install
pnpm env:show        # renames .env → .env.local, moves the files into envs/local/, links them back
pnpm env:check       # lists variables added since that .env was written
```

Nothing is lost. The server's old `.env` is renamed to `.env.local`, the name
the web app already uses. Plain files are then moved, not copied, into
`envs/local/`, and the apps read them through the links. Until you run this,
the API still boots from the old `.env` and prints a warning that says so.
Then:

1. Add `APP_ENV="local"` to `envs/local/web-server.env` and
   `envs/local/web-app.env`. Unset already means local; writing it makes it
   explicit.
2. Copy any variable `env:check` reports as missing from the matching
   `.env.example`, if you need a value other than its default.
3. If the seed password changed, update `SEED_USER_PASSWORD` and run
   `pnpm db:seed`.

### B. A fresh clone, starting clean

```bash
pnpm install
pnpm dev             # creates envs/local/ from the templates, with fresh secrets
```

Fill in `SEED_USER_*` in `envs/local/web-server.env` (your sign-in), then stop
and start `pnpm dev`. On a new database the data snapshot is restored for you.
See the root README.

### C. A fresh clone that should match your other machine exactly

Copy the profile files from your password manager (see below) into
`envs/<name>/`, then:

```bash
pnpm env:use local
pnpm env:check
```

Copy `AUTH_JWT_SECRET` and `AUTH_MFA_SECRET_KEY` only when both machines share
one database. On separate local databases, fresh secrets per machine are
correct: a copied MFA key does nothing, and a different JWT secret only means
signing in again.

## Keeping machines in step

- **A new variable arrives with a `git pull`.** It lands in `.env.example`, not
  in your profiles. `pnpm env:check` names every profile that lacks it. Add it
  where you need a value other than the default.
- **Staging and production values live in a password manager**, one secure note
  per profile file. When you change one on one machine, update the note, and on
  the other machine paste it over `envs/<name>/<app>.env`. Never send them over
  chat or email.
- **Machines don't need identical `local` profiles.** Each one has its own
  database and its own secrets. Only `SEED_USER_*` (your sign-in) should match,
  so the same login works everywhere.
- **Switching is per machine.** `pnpm env:use staging` on one machine changes
  nothing on another.
