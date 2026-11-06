# `module-local-network` — plan

Status: **being built (issue #66).** Phase 1, the Server group, is #76; phase
2, the module's core, is #78; phase 3, the server side, is #80. The rest is
planned. L1–L10 (§8)
are the operator's decisions of 2026-11-04. Once it is built, the decision goes
in PLAN §13, and §10 here records what was built and where it differs from this
plan.

## 1. Why

A shop runs the app on its own computer, and phones and tablets reach it
through Caddy on the shop's Wi-Fi (`docs/HTTPS.md` §3–6). Before a device can
use it, someone has to:

1. know the server's network address, today `192.168.1.68`;
2. type `http://<address>/kwtech-local-ca.crt` by hand, install the
   certificate, and trust it;
3. then open `https://<address>`.

Nothing in the app helps with any of it: the address and the steps are in the
docs only. The docs also go out of date: `docs/HTTPS.md` §5 still gives
`192.168.1.186`. The server computer itself can't reach its own network
address, so it has to get the certificate another way (on 2026-11-04 it was
copied into Windows' Downloads folder by hand).

## 2. What v1 is

A **Local Network** page for super admins, in a new **Server** drawer group
beside Backups. It shows:

1. **The certificate**:
   - a **Download certificate** button for the public root certificate,
     saved as `kwtech-local-ca.crt`;
   - its **SHA-256 fingerprint**, and its **SHA-1** one too (Windows'
     certificate window shows only that, as "Thumbprint"), with its subject
     and expiry date, so a person can compare the fingerprint with what the
     device shows before trusting it;
   - ⚠ **the fingerprint is only worth comparing when it comes from a screen
     that is already trusted.** The phone downloads the certificate over plain
     `http://`, and anybody on the same Wi-Fi can swap that file, and the
     fingerprint shown beside it on any `http://` page, for their own. So the
     reference fingerprint is read on a device whose connection is already
     authenticated: the server computer's own `https://localhost`, or a
     device that already trusts it. ⚠ **The server's browser is trusted only
     once it is registered** (`docs/HTTPS.md` §4 step 6, then §5 for its
     system): `pnpm https:setup` writes the profile and checks Caddy, but does
     not register any browser. Registering it is safe without a fingerprint,
     because that browser takes the certificate from the computer's own
     `.caddy/` folder, never over the network. The test is that
     `https://localhost` opens with **no** certificate warning; a page that
     warns is not a trusted screen. ⚠ **The page cannot detect this itself**
     (corrected 2026-11-06, #76): a browser that clicked through a warning
     still reports `https:` and loads the page normally, and nothing in a
     page's JavaScript says whether its certificate was trusted. So over
     `http://` the page shows no fingerprint, only why; over `https://` it
     shows the fingerprint with the instruction "compare only if this page
     opened with no certificate warning". It is a rule the person follows,
     not one the page enforces. Open Local Network on that trusted screen, download the
     certificate on the device (the QR code below), and compare the
     fingerprint character for character. Trust it only if they match. A page
     opened over `http://` never shows a fingerprint as if it proved anything,
     and the page says all of this beside the fingerprint;
   - ⚠ **where each device shows the fingerprint, and so when to compare.**
     Not every device shows it before installing, so the steps follow the device
     (taken into the per-device steps of §7a, and `docs/HTTPS.md` §5):

     | Device | Where the fingerprint shows | Compare |
     |---|---|---|
     | iPhone, iPad | Settings → General → VPN & Device Management → the profile → More Details → the certificate (SHA-256) | before **Install**, and before turning on full trust in *Certificate Trust Settings* |
     | Android | only after installing: Settings → Security → Encryption & credentials → Trusted credentials → **User** → the certificate | straight after installing; ⚠ if it differs, **remove it at once** there |
     | Mac | Keychain Access → the certificate → Details (SHA-256) | before setting *Always Trust* |
     | Windows | the certificate window → Details → *Thumbprint* (SHA-1) | before **Install Certificate** |
     | Firefox | Settings → Certificates → View Certificates → Authorities → the certificate → View (SHA-256) | before ticking *Trust this CA to identify websites* |

     Menu names differ between versions; the steps say what to look for
     (the SHA-256 or SHA-1 fingerprint) as well as where;
   - an explanation in plain words: what it is for (devices on the shop's
     Wi-Fi open the app without a warning, and live updates work), and ⚠ what
     installing it means. A device that trusts it trusts **any** site this
     authority signs: it has no name limits and is valid until 2036. So it goes
     only on the shop's own devices, never a customer's.
2. **The server's address**:
   - `https://<address>` as plain text, with a copy button;
   - the same address as a **QR code**, so a phone opens it by scanning
     (`QrCode` from `@kwtech/web-ui`);
   - a second QR code for `http://<address>/kwtech-local-ca.crt`, because that
     is the first thing a new phone needs.
3. **This computer**: a line saying the server itself uses `https://localhost`,
   not its network address and not `http://localhost:8081`, where live updates
   cannot connect.

The page reads; it changes nothing. There are no models and no migration.

## 3. The drawer: a shared Server group

```
Server
  ├─ Backups        (module-backup: only its group name changes)
  └─ Local Network  (module-local-network, new)
```

- `module-backup`'s group, `DATABASE_NAV_GROUP` (`'Database'`), becomes
  `SERVER_NAV_GROUP` (`'Server'`), in the same position below
  Administration. Its comment says the group is a place the database's other
  tasks can join later. "Server" keeps that possible, and it also fits Local
  Network, which isn't about the database.
- **The modules stay separate.** Backups is a whole feature (schedule,
  restore, downloads, the command line) and applies on every installation,
  including a remote server. Local Network applies only to a shop's network.
  Modules never import each other (PLAN §9), so each declares the same group
  **name**, a shared string pinned by each module's `web-module.test.ts`, as
  `ADMINISTRATION_NAV_GROUP` is today. No code moves between them.

## 4. On a remote server: switched off, not just empty

The app may later run on a real remote server with a domain
(`docs/HTTPS.md` §7). There, devices use the domain's normal certificate and
install nothing, and the address is the domain. **Local Network does not
apply**, so it must not show up as a page that only ever says "not available".
The rest of the Server group applies everywhere.

- **One switch, read in one place**, copying `module-chat`'s `enabled`
  option (`packages/module-chat/src/enabled.ts`):
  `localNetworkServerModule({ enabled })` and
  `localNetworkWebModule({ enabled })`, both answered by one
  `localNetworkIsEnabled()` in the module's root.
- ⚠ **The default is OFF**, the opposite of chat. Chat is on because a host
  that composed it wanted it. This page is right for one kind of installation
  only, and on any other it would show an address and a certificate that are
  wrong there. Fail closed: `enabled !== true` means off.
- **Off means absent**: no resolvers, no page, no drawer entry, exactly as
  chat's switch (`packages/module-chat/src/enabled.ts`). The operation is not
  in the schema at all, so a request that sends it anyway gets GraphQL's own
  "cannot query field" error, the same as any field that does not exist. There
  is no separate refusal reason to define: the web app never sends the query
  while off, because its page is not composed either.
- ⚠ **The feature registry stays composed while off**, as chat's does (its
  comment explains why). Otherwise `db:sync` deprecates `local_network:*`, and
  turning the page back on would bring it back without its grants.
- **What turns it on is the profile, written by the setup that makes it
  true.**
  - `LOCAL_NETWORK="on"` in `web-server.env` and
    `NEXT_PUBLIC_LOCAL_NETWORK="on"` in `web-app.env`. The web app bakes the
    second in at build, like `NEXT_PUBLIC_WS_URL`. Both are validated in each
    app's `src/config/env.ts` and documented in the `.env.example` files,
    off by default.
  - `pnpm https:setup` sets both, and `pnpm https:setup --off` removes them,
    so the page appears and disappears with local HTTPS itself. The setup
    already says `pnpm build` is needed afterwards.
  - A remote server's profile (`pnpm env:new <name>`, `docs/HTTPS.md` §7)
    never has them, so nothing has to be remembered on a remote server.
  - ⚠ **When the two disagree, it fails closed, and says so.** They are read
    at different times (the server's when the API starts, the web app's when
    it is BUILT), so a profile changed without a rebuild, or edited by hand,
    can leave them apart:
    - **Web on, server off:** the page is in the drawer, but its query is not
      in the schema. The page treats GraphQL's "cannot query field" for its
      own query as off: it shows no certificate and no address, only "Local
      Network is off on this server's API. Run `pnpm https:setup` (or `--off`),
      then `pnpm build`." Never an error screen, and never a stale address.
    - **Server on, web off:** the query exists but no page sends it. Nothing
      shows. The query is guarded by `local_network:read` and returns only
      public things (the certificate and the published address), so nothing
      leaks; it is simply unused until the next build.
    - **Caught before it happens:** `pnpm env:check` reports a profile whose
      `web-server.env` and `web-app.env` disagree on the switch, and
      `pnpm https:setup` (and `--off`) always writes both together.
- **On, but local HTTPS missing** (`.caddy/` deleted, or not copied to a new
  machine): the page stays and says why. "Local HTTPS is on in this profile,
  but its certificate is not on this computer: run `pnpm https:setup`
  (`docs/HTTPS.md` §4)." It shows no certificate and no address.
- **On, but the published address is not the shop's network** (a profile
  edited by hand: `FRONTEND_URL` left at `http://localhost:8081`, or a remote
  domain): ⚠ the address and the certificate would not apply there, so
  neither is shown. The rule starts from the one Caddy's launcher already
  uses (`deploy/https/host.cjs`, `httpsHost`: an `https:` URL whose host is a
  private IPv4 address, 10.x, 172.16–31.x or 192.168.x), but ⚠ checks the
  WHOLE origin, not only its host. `httpsHost` keeps the hostname and drops
  the rest, while this page publishes `FRONTEND_URL` itself as the address and
  the QR code; a hand-edited `https://192.168.1.68:8443` would pass on its
  host and lead every phone to a port Caddy does not listen on (it serves
  `https://{$KWTECH_HTTPS_HOST}`, port 443). So the published address must be
  exactly `https://<private IPv4>`: no port (443 only), no user or password,
  no path, no query, no fragment — in practice,
  `new URL(FRONTEND_URL).origin === FRONTEND_URL` with no trailing slash.
  The page says "Local Network is on, but this profile publishes
  `<FRONTEND_URL>`, not an address on the shop's network: run
  `pnpm https:setup`."
- **Where the rule lives: ONE copy that needs no build.** Its three readers
  run at different times, and two of them before anything is built: the PM2
  launcher (`ecosystem.config.cjs`; ⚠ `pnpm pm2:start` does NOT build, despite
  that file's header, which this work corrects), `pnpm env:check`
  (`scripts/env.mjs`), and the API. So it is not in the module's `src/domain/`,
  which exists only as `dist/` after a build. It is a plain CommonJS file with
  no dependencies, `deploy/https/origin.cjs` (`checkLocalOrigin(url)` →
  `{ ok: true, host }` or `{ ok: false, problem }`), beside the `host.cjs`
  the launcher already requires:
  - **the launcher** requires it directly, and `httpsHost()` becomes a call to it;
  - **`pnpm env:check`** imports it (an ES module can import CommonJS);
  - **the API** reads it once at boot in `apps/web-server/src/config/env.ts`
    (through `createRequire`, from the repository root, as the scripts do) and
    passes the module the answer as an option. The module never reads
    `FRONTEND_URL` and holds no copy of the rule (PLAN §9 rule 6: the app
    configures). A jest test in `apps/web-server/test/` covers the rule's cases.
- **Who checks, and what each does on a bad origin:**
  - **The launcher, always, whichever way the switches are.** When
    `FRONTEND_URL` is `https://` on a private IPv4 address but fails the
    whole-origin rule (a port, a path, userinfo, a query, a fragment, or a
    malformed URL such as `https://:443`), it stops with an error that names
    the problem and says to run `pnpm https:setup`. ⚠ It never leaves
    `kwtech-https` out silently, as today's "no host, no Caddy" branch does:
    that branch stays only for profiles with nothing to serve on the shop's
    network. Domain and `http://` profiles are outside this check, and start
    as they do now (a remote server runs no Caddy).
  - **The API**, while the switch is on, answers the page "not set up", with
    the problem, instead of an address. That covers the web side too: the web
    app has no address of its own and shows only what the API answers.
  - **`pnpm env:check`** reports the same problem in the same words, for any
    profile whose `FRONTEND_URL` is `https://` on a private address, switch on
    or off, so it is caught before anything is started or built.

  A bad origin and local HTTPS missing are the only "not available" states
  left, and each is a real fault worth showing.

## 5. The rules

- **Never the private key.** Only `root.crt` is read. `root.key`,
  `intermediate.key` and `intermediate.crt` are never read, listed or served.
  The module is given the path of that one file, not the folder, and a test
  checks that no other file in the folder is opened.
- **The module knows no paths and no addresses.** The app passes both as
  options to `localNetworkServerModule({...})`:
  - the certificate: `.caddy/pki/authorities/local/root.crt`, the folder
    `pnpm https:setup` uses;
  - the address: from the profile's `FRONTEND_URL`, which `pnpm https:setup`
    writes. It is not guessed from network interfaces: under WSL, what Linux
    sees and what phones reach can differ.
- **The certificate is returned as text** by a guarded GraphQL query (a few
  hundred bytes of PEM), with its fingerprint, subject and expiry worked out on
  the server (`node:crypto`'s `X509Certificate`). The browser saves it as a
  file. Unlike a backup, it is public and small, so it needs no ticket and no
  REST route.
- **Pure logic in `src/domain/`**, tested there: the addresses built from
  the published origin (`https://<address>`, `http://<address>/kwtech-local-ca.crt`),
  and the switch (`localNetworkIsEnabled`).
- **The resolver declares app scope.** Super admins hold every registered
  key, so by default only they have `local_network:read` after `db:sync`,
  as with `backup:*`. A super admin can grant the key to another role on the
  Roles page.

## 6. Keys (app level)

⚠ Snake_case, `local_network:read` (corrected 2026-11-06, #78): this plan first
wrote `local-network:read`, but every key here is snake_case (`app_hub:read`),
and module-permissions' `FEATURE_KEY_PATTERN` refuses a hyphen.

| Key | What it allows |
|---|---|
| `local_network:read` | the page: the certificate, its details, and the addresses |

Granted to nobody by the module. `super-admin` holds every registered key.

## 7. Later additions

Two kinds, kept apart because they answer the switch differently.

### 7a. More of Local Network (the shop's network only, behind its switch)

These are about devices on the shop's Wi-Fi reaching this computer, so they
are wrong on a remote server, exactly like v1. They are sections of the Local
Network page, behind the same `localNetworkIsEnabled()`, and they disappear
with it.

- **Steps per device type**, inside Local Network: Android, iPhone and iPad
  (Install, then *Certificate Trust Settings*), Mac, Windows, Firefox, taken
  from `docs/HTTPS.md` §5 and shown in tabs.
- **A connection check**, inside Local Network: is Caddy answering on 443,
  does a WebSocket upgrade on `/api/v1/graphql` succeed, does the certificate
  download answer. Each check is green or red, with what to do when red
  (`docs/HTTPS.md` §10).
- **Address changed**, inside Local Network: a warning when the machine's
  current address isn't the one the profile publishes ("Run
  `pnpm https:setup` again; phones keep their certificate").
- **Print agents**, inside Local Network: the address a print agent on another
  computer should use, with a copy button.
- **Installing the app on a phone**, inside Local Network: a pointer to
  `docs/HTTPS.md` §6 after the certificate step.

### 7b. Other pages for the Server group (every server, never behind the switch)

These aren't part of Local Network. Each would be its own page, and probably
its own module or part of the module that owns the subject, in the same
drawer group. **All of them apply on a remote server too**, so none of them
uses Local Network's switch, and each must report "unknown here" rather than a
wrong answer when it can't tell. Only Local Network (v1 and §7a) reads the
switch.

- **Server status**: version and commit running, uptime, the active env
  profile's name (never its values), and whether the built web app is older
  than the code (merged but not rebuilt).
- **Disk space**: free space on the drive holding the database and
  `backups/`, with a warning before backups start failing.
- **Services**: the API, the web app and Caddy, running or not, read only. No
  restart button at first: a restart from the page would stop the page itself.
  ⚠ A remote server may not use pm2 (Docker, systemd, a hosting platform) or
  Caddy at all: there it says "not managed by pm2 here", not "stopped".
- **Logs**: the last few hundred lines of the API's log, filtered by level,
  for diagnosing without a terminal. Secrets must not appear in them, which
  the API's logger already has to guarantee.
- **Database**: size, the last migration applied, and `db:sync` state, beside
  Backups.

## 8. Decisions (operator, 2026-11-04)

| # | Decision |
|---|---|
| L1 | A module of its own, administrative, for super admins only |
| L2 | Named **Local Network**, not "Local Setup", which could mean a developer's own computer or the dev database |
| L3 | v1 is the certificate download with its explanation, and the server's address as text and as a QR code |
| L4 | A **Server** drawer group, below Administration, replaces the Database group. Backups moves into it; the modules stay separate |
| L5 | On a remote server the page does not exist: a switch, off by default, turned on by `pnpm https:setup` |
| L6 | The private key is never read or served |
| L7 | The address comes from the profile, not from the network interfaces |
| L8 | The certificate is returned as text by a query, not through a ticket and a REST route |
| L9 | Later additions (§7a for Local Network, §7b for the other Server pages) are direction only, each its own issue |
| L10 | The page reads and changes nothing; no restart or setup buttons in v1 |

## 9. Phases, one commit each

1. **The Server group.** `module-backup`'s group renamed to "Server" and its
   test updated. The drawer shows Server → Backups. PLAN §12.123 and other
   docs that say "Database → Backups" are updated.
2. **The module's core.** `packages/module-local-network`: feature key and
   registry, the switch, the address helpers in `src/domain/`, the GraphQL
   operation in `src/operations.ts`, with tests.
3. **The server side.** `localNetworkServerModule({ enabled, certificatePath, publishedOrigin })`:
   the guarded query, app scope, the certificate read and its details, the
   "not enabled" and "not set up" answers. Tests against a temporary folder,
   including that the key files are never opened.
4. **The page.** `localNetworkWebModule({ enabled })`: the page in the Server
   group, the certificate section, the address and both QR codes, the
   "this computer" line, the not-set-up message.
5. **Wiring and the switch.** Both apps (`DECLARING_MODULES`,
   `MODULE_DECLARATIONS`, `WEB_MODULES`, the env vars and their validation),
   `pnpm https:setup` writing the switch and `--off` removing it, and
   `pnpm env:check` reporting a profile whose two files disagree on it, or
   whose private `https://` `FRONTEND_URL` fails the whole-origin rule (switch
   on or off). `deploy/https/origin.cjs` with its jest test; the launcher
   failing loudly on a bad origin instead of dropping `kwtech-https`; and
   `ecosystem.config.cjs`'s header corrected (`pnpm pm2:start` does not build).
6. **Docs.** The module's README, `docs/HTTPS.md` (§5 points to the page, its
   address corrected, §7 says the page is off on a remote server), the
   CLAUDE.md package list, and the PLAN §13 entry.

## 10. Built, and where it differs

Not built yet.
