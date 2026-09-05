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

### The settings pages' Back link

`ProfilePage`, `SecurityPage` and `TwoFactorPage` render a "Back to …" link
above the heading, and each takes `backTo` to move it:

```tsx
<ProfilePage viewer={viewer} backTo={{ href: '/account', label: 'Account' }} />
```

The defaults assume these routes are mounted where the descriptor puts them.
`TwoFactorPage` points at `/settings/security`, which is its real parent — it is
unlisted in the navigation and reached only from Security. Profile and Security
are PEERS rather than children of one another, so they point at the app's home
(`/`, labelled "Dashboard"); override `backTo` if yours lives elsewhere or if
you mount these under a prefix.

Pass it to `ProfileRouteInner` instead when you use the descriptor's route, and
it reaches the loading and error states too — not just the loaded form.

## Features this module declares

`AUTH_FEATURE_REGISTRY` carries the module's grantable rights, typed by
`@kwtech/module-kit` rather than by `@kwtech/module-permissions` — the two
modules never import each other.

```ts
import { AUTH_FEATURE, AUTH_FEATURE_REGISTRY } from '@kwtech/module-auth';
```

| key | governs |
|---|---|
| `account:profile_write` | change your own display name and username |
| `account:two_factor_enrol` | add a second factor |
| `account:two_factor_remove` | take one off |

**The rule this module follows: a surface gets a key only when it needs
AUTHORISATION, not merely a session.** Those are different questions, and
conflating them is how people get locked out of their own accounts.

| needs | example | key? |
|---|---|---|
| neither sign-in nor authorisation | `/auth/signin`, `/auth/forgot-password` | no |
| sign-in only | `/settings/*` (reaching them) | **no** |
| sign-in **and** authorisation | changing your profile, removing a factor | yes |

So the settings ROUTES carry no key — the pages stay reachable and a withheld
key costs a disabled control rather than a locked door — while the writes behind
them do.

**Enrol and remove are separate keys on purpose.** Withholding removal is how a
policy makes 2FA mandatory; withholding enrolment would stop someone protecting
their own account, which weakens security rather than enforcing it.

**Password change is deliberately unkeyed.** Keying it would be leaky or
dangerous with nothing in between: `/auth/forgot-password` is unkeyed and always
reachable, so blocking the settings page stops nothing — and closing that hole
too would leave someone with a compromised password unable to fix it, with no
admin-side reset to fall back on.

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

## The server descriptor

`authServerModule()` returns a `ServerModuleDescriptor`, so an app composes this
module the same way it composes any other:

```ts
const SERVER_MODULES = [authServerModule({ prismaProvider, getRequest, ... }), permissionsServerModule({ ... })];

@Module({ imports: [...serverModuleImports(SERVER_MODULES)] })
export class AppModule {}
```

It carries `features: AUTH_FEATURE_REGISTRY`, so anything composing from a list
of descriptors sees this module's rights. No `routePrefix` by default —
`AuthController` is `@Controller('auth')` under the app's global prefix, so
passing one would nest it twice.

⚠️ Constructing the descriptor calls `AuthModule.forRoot()`, which asserts
`AUTH_JWT_SECRET` at construction. That is deliberate — a missing secret fails
at boot rather than at the first sign-in — but it means a SCRIPT that only wants
the feature list should import `AUTH_FEATURE_REGISTRY` directly rather than
building the descriptor.

## The seam

Other modules that need to call the API on the viewer's behalf take the token,
they do not read the cookie:

```ts
const token = await getSessionToken();
const permissions = await getPermissionContext({ token }); // @kwtech/module-permissions/next
```

`module-auth` and `module-permissions` never import each other. One direction,
one function — the same arrangement as `resolvePrincipal` on the server.
