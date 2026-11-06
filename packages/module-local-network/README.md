# @kwtech/module-local-network

**Local Network** (issue #66): a super admin's page for getting phones,
tablets and computers onto an app that runs on the shop's own network, behind
Caddy (`docs/HTTPS.md` §3–6). It shows the local authority's **public**
certificate, with its fingerprints and an explanation, and the server's
address as text and as QR codes, so nobody has to read the docs or ask what
the address is.

⚠ **Being built.** Only the pure core exists so far (#78). The server half
(`/server`), the page (`/react`) and the wiring into both apps come in phases
3–5 of `docs/LOCAL-NETWORK-PLAN.md` §9. No app composes it yet.

## The domain entry point

```ts
import {
  LOCAL_NETWORK_FEATURE,          // { read: 'local_network:read' }
  LOCAL_NETWORK_FEATURE_REGISTRY, // for the app's seed, ALWAYS composed (below)
  localNetworkIsEnabled,          // the switch: on only for `enabled: true`
  localNetworkAddresses,          // host → { appUrl, certificateUrl }
  localNetworkStateMessage,       // what the page says when it shows nothing
  LOCAL_NETWORK_API_OFF_MESSAGE,  // the page's words when only the API's switch is off
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

Off means **absent**: no resolvers and no page, so the query is not in the
schema. ⚠ A host that switches it off still composes
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
| `certificate_missing` | nothing but `problem`: run `pnpm https:setup` |
| `origin_invalid` | nothing but `problem`, naming the `FRONTEND_URL` the profile publishes |

## What it declares

| Key | Level | What it allows |
|---|---|---|
| `local_network:read` | app | the page: the certificate, its details, and the addresses |

Granted to nobody by the module; `super-admin` holds every registered key. Not
privileged: everything it shows is public already, and the private key is
never read. ⚠ Snake_case, not `local-network:read`: module-permissions'
`FEATURE_KEY_PATTERN` refuses a hyphen. Its binding, `Query.localNetwork`,
is added with the resolver in phase 3.
