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

Your OWN account:

| key | governs |
|---|---|
| `account:profile_write` | change your own display name and username |
| `account:two_factor_enrol` | add a second factor |
| `account:two_factor_remove` | take one off |

SOMEBODY ELSE'S account — the administration surface, all app level and all
privileged. Four keys, shaped like `roles:*` and `plans:*`:

| key | governs |
|---|---|
| `users:read` | list, search, open any account, and see where it is signed in |
| `users:update` | rename it, send a password reset, end its sessions, remove its second factor |
| `users:disable` | suspend it so it cannot sign in, and lift the suspension |

There is no `users:create` either. **This module never creates an account from
an administrator's form.** One comes into being when somebody accepts an
invitation and chooses their own password — `inviteUser` in
`@kwtech/module-permissions`, behind `roles:grant_app`. So an administrator
never types another person's credential, and the Users list's New button is a
link to that screen.

There is deliberately **no `users:delete`**. Every membership, invitation and
accepted-by record points at the account, and `perm_membership.userId` has no
foreign key to `auth_user` (PLAN §12.12) — so a delete leaves rows pointing at
nobody rather than cascading. Suspension keeps the row, keeps the history and is
reversible, the same call `roles:disable` and `plans:archive` make.

⚠ **`users:update` carries the credential operations.** A reset alone does not
get past a second factor and removing a factor does not get past an unknown
password, but one key grants both — so holding it is a path into any account.
That is a deliberate trade of least privilege for a vocabulary that matches the
rest of the admin app; splitting the credential half back out is one key and a
binding move.

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
too would leave someone with a compromised password unable to fix it. That last
clause is now weaker than it was: `users:password_reset` IS the admin-side
fallback, so the decision is open rather than blocked.

## Administering users

`/admin/users`, `/admin/users/:userId` and `/admin/users/:userId/edit`,
declared on `authWebModule` like every other route this module ships. Reading
and editing are separate routes, gated by separate keys — the detail page holds
the account's ACTIONS, the edit page its profile. Creating is not here at all;
the list links to `/admin/invitations/new`, which `module-permissions` owns. Nothing to mount:
composing the module is what adds them.

```ts
import { AuthAdminService } from '@kwtech/module-auth/server';
```

**Why user administration is in THIS module.** It reads and writes `auth_user`,
`auth_session`, `auth_credential` and `auth_mfa_factor` — this module's tables.
"App-level admin right" does not mean "declared in `module-permissions`": a
module contributes its own rights through `FeatureContribution`, and the app
composes the lists. Permissions enforces these keys without learning they exist.

**How a handler here is guarded without importing the guard.**
`@RequireAuthFeature` writes the metadata `FeatureGuard` reads, and the metadata
KEY lives in `@kwtech/module-kit` so the two modules agree on it without one
importing the other. The guard, and the resolution of who holds what, stay in
`module-permissions`. ⚠ An app that composes this module and installs no feature
guard has these mutations unguarded — a declaration nothing reads is not a
check.

**There is no operation that SETS a password for somebody else** — only a reset
to the account's own address. An administrator who could type one would hold
that person's credential, and every "was that you or support?" question
afterwards would be unanswerable.

**Suspension ends sessions.** `signIn` refusing a suspended account is only half
of it: the access token verifies from its signature with no database read, so
without revocation "suspend" would mean "cannot sign in again" for up to a week.

**The edit form validates through `validateUserDraft` in `domain/`** — the same
function `AuthAdminService.updateProfile` calls, so the form cannot accept
something the API will refuse. The arrangement `role-draft.ts` uses, for the
same reason. It has no address or password field: the address is the identifier
the invitation set, and credentials are changed by sending a reset.

**The app-level role shown on the grid and edited on that form is not this
module's.** It comes from `permissionUserAppRoles` and `assignAppRole` in
`module-permissions`, named by convention the way that module's own client names
the app-provided `findUserByEmail`. The reads fail soft — an app composing this
module without a permissions module gets an empty column rather than a broken
page — and the write does not, because a failed grant reporting success would be
a lie about somebody's permissions.

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
