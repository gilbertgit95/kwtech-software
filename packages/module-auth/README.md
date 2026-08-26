# @kwtech/module-auth

Authentication as a whole vertical slice: identity tables, credential and token
logic, the REST surface, Nest wiring, Next route handlers and React pages.

Adopting it is **two lines per surface**. Everything else has a default, and
every default can be overridden.

📖 **[docs/USAGE.md](docs/USAGE.md)** — the full reference: how a token becomes a
session, the security properties not to regress, the seam with
`module-permissions`, extension points and troubleshooting. Read that before
changing anything in here.

## In a Next.js app

```ts
// src/modules.ts — routes, navigation and feature keys
import { authWebModule } from '@kwtech/module-auth/react';
export const WEB_MODULES = [authWebModule];
```

```ts
// src/app/api/auth/[...action]/route.ts — the whole API surface
export { POST } from '@kwtech/module-auth/next';
```

That gives you `/auth/signin`, `/auth/verify`, `/auth/forgot-password` and
`/auth/reset-password` as rendered pages, and `signin`, `verify-mfa`,
`forgot-password`, `reset-password` and `signout` as endpoints that keep the
tokens in httpOnly cookies the page's JavaScript cannot read.

Reading the session, anywhere on the server:

```ts
import { getViewer } from '@kwtech/module-auth/next';
const viewer = await getViewer(); // null when signed out — never throws
```

The route file is the one piece that cannot be a package export: Next discovers
route handlers from the filesystem and nothing can inject one. It never has to
change again when the module gains an action.

## In a NestJS app

```ts
import { AuthModule } from '@kwtech/module-auth/server';
AuthModule.forRoot({ prismaProvider: { provide: AUTH_PRISMA, useExisting: PrismaService } });
```

Then apply `JwtAuthGuard` globally with `APP_GUARD`. Global on purpose:
authentication is opt-out via `@Public`, so a handler nobody annotated is
protected rather than anonymous.

Only the Prisma binding has no default — the database client is the app's.
Two options switch a feature on rather than configure one, and both refuse
rather than half-working without it:

- `sendPasswordResetEmail` — forgot-password. The obvious fallback, logging the
  link, writes a working credential into the log aggregator.
- `mfaSecretKey` (or `AUTH_MFA_SECRET_KEY`) — two-factor authentication. A TOTP
  secret is symmetric and cannot be hashed, so without a key there is no safe
  way to store one.

Rate limiting is yours too: the module exports `CREDENTIAL_ENDPOINTS` so a
throttler can be pointed at the guessing endpoints without matching URLs.

## Two-factor authentication

TOTP, with recovery codes. Sign-in returns `mfaRequired` and a token scoped to
one endpoint; `refresh()` **re-derives** that scope from the session row, so
waiting out the access token is not a way past the second factor. Enrolling or
removing a factor needs the current password, not just a session.

See [docs/USAGE.md §6a](docs/USAGE.md) for the flow, the storage decision and
what is deliberately not enforced.

## Environment

The defaults are a published contract, not a guess — set these and the module
is configured; pass values explicitly and none of them is read.

| Variable | Used by | Default |
|---|---|---|
| `API_URL` | `/next` | `http://localhost:8080/api/v1` |
| `SESSION_COOKIE` | `/next` | `kwtech_session` (refresh token gets `_refresh`) |
| `AUTH_JWT_SECRET` | `/server` | **none — `forRoot` throws** |
| `AUTH_TOKEN_ISSUER` | `/server` | `kwtech-web-server` |
| `AUTH_TOKEN_AUDIENCE` | `/server` | `kwtech-api` |
| `AUTH_MFA_SECRET_KEY` | `/server` | **none — enrolment refuses** |
| `AUTH_MFA_ISSUER_LABEL` | `/server` | falls back to `AUTH_TOKEN_ISSUER` |

The secret is the deliberate exception. A module-supplied fallback would be the
same secret in every deployment that forgot to set one — worse than a failed
boot, because nothing ever reports it.

## Customising

```ts
// A different cookie name, or config from somewhere other than the environment
import { createAuthRouteHandlers } from '@kwtech/module-auth/next';
export const { POST } = createAuthRouteHandlers({ apiUrl, cookieName, secure });
```

`getViewer` and `getSessionToken` take the same overrides.

## Entrypoints

| Import | What it is | Safe in |
|---|---|---|
| `@kwtech/module-auth` | pure core — types, policy, no framework | anywhere |
| `@kwtech/module-auth/react` | pages and the browser client (`'use client'`) | browser |
| `@kwtech/module-auth/next` | route handlers and the server session read | Next server |
| `@kwtech/module-auth/server` | Nest module, guard, services | Nest |
| `@kwtech/module-auth/prisma` | the schema fragment | `prisma` composition |

`/react` never imports `/server` (PLAN §9 rule 3) — that is what keeps
`node:crypto` and the JWT secret out of the browser bundle. `/next` does not
either: it talks to the API over HTTP exactly as the browser does.

## The seam

Other modules that need to call the API on the viewer's behalf take the token,
they do not read the cookie:

```ts
const token = await getSessionToken();
const permissions = await getPermissionContext({ token }); // @kwtech/module-permissions/next
```

`module-auth` and `module-permissions` never import each other. One direction,
one function — the same arrangement as `resolvePrincipal` on the server.
