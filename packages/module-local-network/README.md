# @kwtech/module-local-network

**Local Network** (issue #66): a super admin's page for getting phones,
tablets and computers onto an app that runs on the shop's own network, behind
Caddy (`docs/HTTPS.md` §3–6). It shows the local authority's **public**
certificate, with its fingerprints and an explanation, and the server's
address as text and as QR codes, so nobody has to read the docs or ask what
the address is.

Built in phases (#66): the pure core (#78), the server half (#80), the page
(#82), and the wiring into both apps with its switches (#84). Both apps
compose it; it shows only where `pnpm https:setup` turned it on.

## Turning it on, on the shop's server

Both apps compose the module already. On the computer that serves the shop's
network (`docs/HTTPS.md` §4):

```bash
pnpm https:setup                               # writes LOCAL_NETWORK="on" and NEXT_PUBLIC_LOCAL_NETWORK="on"
pnpm --filter @kwtech/web-server db:sync       # once, on a database from before this module: adds local_network:read
pnpm build                                     # the web app's switch is baked in at build
pnpm pm2:start                                 # does not build
```

Then, as a super admin on `https://localhost`: **Server → Local Network**.
If the entry is missing, one of the three is: the switches (`pnpm env:check`
says when they disagree), the build, or the sync (`docs/HTTPS.md` §10).
`pnpm https:setup --off` turns both switches off; the key and its grants
stay.

## In a Next.js app

```ts
import { localNetworkWebModule } from '@kwtech/module-local-network/react';

localNetworkWebModule({ enabled: process.env.NEXT_PUBLIC_LOCAL_NETWORK === 'on' });
```

- **Off** (the default): no page and no drawer entry. The key stays in the
  descriptor.
- **On**: `/admin/server/local-network`, in the **Server** drawer section
  (order 60) after Backups (entry order 20, icon `globe`), behind
  `local_network:read`. The group's name is the string `'Server'`, declared
  here and in module-backup alike (`SERVER_NAV_GROUP`), each pinned by its own
  `web-module.test.ts`.

The page, top to bottom:

1. **The certificate**: *Download certificate* (the PEM, saved as
   `kwtech-local-ca.crt`), who it names, when it expires, and ⚠ that a
   device trusting it trusts **any** site this authority signs, so it goes
   only on the shop's own devices.
2. **The fingerprints**, SHA-256 and SHA-1, and where each device shows
   them. ⚠ **Over `http://` they are not shown**, only why: anyone on the
   Wi-Fi could change that page. Over `https://` they are shown with "compare
   only if this page opened with no certificate warning". The page cannot tell
   whether its browser clicked through a warning (it still reports `https:`),
   so that is a rule it states, not one it enforces.
3. **The address**: `https://<address>` with *Copy*, and two QR codes, the
   certificate's download address first (what a new device needs) and the app
   second.
4. **This computer**: the server opens `https://localhost`.

**Not set up** (`off`, `certificate_missing`, `origin_invalid`): the API's
sentence and nothing else. `off` is what a page sees when its own switch is on
and the API's is off (a profile changed without a rebuild): it says what to
run, never an error screen.

## In a NestJS app

```ts
import { localNetworkServerModule } from '@kwtech/module-local-network/server';

localNetworkServerModule({
  enabled: env.LOCAL_NETWORK === 'on',                 // off unless exactly true
  certificatePath: '<repo>/.caddy/pki/authorities/local/root.crt', // ONE file, never the folder
  origin: checkLocalOrigin(env.FRONTEND_URL),          // deploy/https/origin.cjs (phase 5)
  publishedOrigin: env.FRONTEND_URL,                   // named in the message when it is wrong
  resolveActorId: (request) => …,
});
```

| Option | Required | What it is |
|---|---|---|
| `enabled` | no | The switch. Anything but `true` is off: the query still exists and answers `off`, nothing is read, and nothing below is checked. |
| `certificatePath` | while on | The path of `root.crt`. A path ending in `.key` stops the boot. |
| `origin` | while on | `{ ok: true, host } \| { ok: false, problem }`, the whole-origin rule's answer. The module holds no copy of the rule. |
| `publishedOrigin` | no | The `FRONTEND_URL` that answer is about. |
| `resolveActorId` | yes, in practice | Principal → `userId`. Without it every call is refused as signed out. |
| `expose.graphql` | no | Default `true`. |

There are no ports, no Prisma client and no REST route: the module reads one
file and answers one query.

**`Query.localNetwork`** (app level, no scope declared, bound to
`local_network:read`) returns a `LocalNetworkView`, worked out on **every
request**, so a new `pnpm https:setup` or a deleted `.caddy/` shows on the next
page load without restarting the API:

1. the switch off → `off`, and nothing is read;
2. origin not on the shop's network → `origin_invalid`, and ⚠ the certificate
   is not even read;
3. certificate missing or unreadable → `certificate_missing`;
4. otherwise `ready`, with the details from `node:crypto`'s
   `X509Certificate` (the same fingerprints `openssl x509 -fingerprint` prints).

### ⚠ The private key is never read

- Only `certificatePath` is ever opened. Nothing lists the folder, which holds
  `root.key` and `intermediate.key`.
- A file that holds a `PRIVATE KEY` block is refused, and the page says "not
  set up".
- The PEM returned is the **parsed** certificate re-encoded, never the file's
  bytes, so nothing else in the file can reach the page.
- `test/local-network.service.test.ts` reads a folder laid out as Caddy's
  through a recording reader, and asserts `root.crt` is the only path opened.

## The domain entry point

```ts
import {
  LOCAL_NETWORK_FEATURE,          // { read: 'local_network:read' }
  LOCAL_NETWORK_FEATURE_REGISTRY, // for the app's seed, ALWAYS composed (below)
  localNetworkIsEnabled,          // the switch: on only for `enabled: true`
  localNetworkAddresses,          // host → { appUrl, certificateUrl }
  localNetworkStateMessage,       // (state, { publishedOrigin, problem }) → what the page says when it shows nothing
  LOCAL_NETWORK_OPERATIONS,       // the one query the page sends
  type LocalNetworkView,
} from '@kwtech/module-local-network';
```

Imports nothing but `@kwtech/module-kit`.

## The switch: off by default

`localNetworkIsEnabled({ enabled })` is the one reader, copied in shape from
module-chat's, with the default turned the other way: **anything but
`enabled: true` is off.** This page is right only on a shop's own network; on
a remote server with a domain it would publish an address and a certificate
that are wrong there, and a remote server's profile never sets the switch
(`docs/LOCAL-NETWORK-PLAN.md` §4).

What off means differs by side (operator, 2026-11-06, #84):

- **The web app:** absent. No page and no drawer entry.
- **The API:** present. `Query.localNetwork` is in the schema either way and,
  off, answers `state: 'off'` with what to run, reading nothing. Not absent,
  because the committed `apps/web-server/schema.graphql` is rewritten at every
  boot, and a field that came and went with a profile setting would make that
  file, and `module-operations.test.ts`, differ from machine to machine. It is
  still guarded by `local_network:read`.

⚠ A host that switches it off still composes
`LOCAL_NETWORK_FEATURE_REGISTRY` in its seed, or `db:sync` deprecates
`local_network:*` and turning it back on loses the grants.

## The addresses

`localNetworkAddresses(host)` takes the **host** that the whole-origin rule
returns (`deploy/https/origin.cjs`, phase 5), not the published origin, so a
port, a path or a user can never reach a QR code:

- `https://<host>`: the app;
- `http://<host>/kwtech-local-ca.crt`: the certificate, over plain HTTP
  because it is the one thing a new device can open. The path is Caddy's
  (`deploy/https/Caddyfile`), and a test reads the Caddyfile to keep them
  the same.

It does not decide whether the host is on the shop's network: that rule has
one copy, in `origin.cjs`.

## What the page can be told

`LocalNetworkView.state`:

| State | Shown |
|---|---|
| `ready` | the certificate (PEM, SHA-256, SHA-1, subject, expiry) and both addresses |
| `off` | nothing but `problem`: the API's switch is off |
| `certificate_missing` | nothing but `problem`: run `pnpm https:setup` |
| `origin_invalid` | nothing but `problem`, naming the `FRONTEND_URL` the profile publishes |

## What it declares

| Key | Level | What it allows |
|---|---|---|
| `local_network:read` | app | the page: the certificate, its details, and the addresses |

Granted to nobody by the module; `super-admin` holds every registered key. Not
privileged: everything it shows is public already, and the private key is
never read. ⚠ Snake_case, not `local-network:read`: module-permissions'
`FEATURE_KEY_PATTERN` refuses a hyphen. It guards `Query.localNetwork`.
