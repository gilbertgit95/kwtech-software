# Using `@kwtech/module-auth`

Reference for implementing against this package — written for whoever (or
whatever) picks it up next. The [README](../README.md) is the two-minute
version; this is the one that answers "why did it do that".

---

## 1. What this package is

Authentication as a **whole vertical slice**: the identity tables, the
credential and token logic, the REST surface, the Nest wiring, the Next route
handlers and the React pages — one package, five entrypoints.

It owns **identity** (who you are). It does **not** own **authorisation** (what
you may do); that is `@kwtech/module-permissions`. The two never import each
other. See §8.

### Entrypoints

| Import | Contains | Safe in | May import |
|---|---|---|---|
| `@kwtech/module-auth` | types, policy, pure functions | anywhere | nothing |
| `@kwtech/module-auth/react` | pages, browser client (`'use client'`) | browser | core |
| `@kwtech/module-auth/next` | route handlers, server session read | Next server | core |
| `@kwtech/module-auth/server` | Nest module, guard, services | Nest | core |
| `@kwtech/module-auth/prisma` | `auth.prisma` schema fragment | schema composition | — |

**The rule that matters:** `/react` and `/next` never import `/server`
(PLAN §9 rule 3). That is what keeps `node:crypto`, the JWT secret and the
database out of the browser bundle. `/next` talks to the API over `fetch`,
exactly as the browser does.

---

## 2. Adding it to a Next.js app

**Two lines, one file each.**

```ts
// src/modules.ts — contributes pages, navigation and feature keys
import { authWebModule } from '@kwtech/module-auth/react';
export const WEB_MODULES = [authWebModule];
```

```ts
// src/app/api/auth/[...action]/route.ts — the whole browser-facing API
export { POST } from '@kwtech/module-auth/next';
```

You now have:

| Route | Kind | Notes |
|---|---|---|
| `/auth/signin` | page | `?next=` honoured only when app-relative |
| `/auth/verify` | page | the 2FA challenge; carries `?next=` across |
| `/auth/forgot-password` | page | |
| `/auth/reset-password` | page | reads `?token=` |
| `POST /api/auth/signin` | endpoint | sets both httpOnly cookies |
| `POST /api/auth/verify-mfa` | endpoint | the only proxied action that **sends** the session |
| `POST /api/auth/forgot-password` | endpoint | always 202 — see §6 |
| `POST /api/auth/reset-password` | endpoint | |
| `POST /api/auth/signout` | endpoint | revokes **and** clears; 303 |

All four pages declare `chrome: 'bare'`, so an app shell that honours that
field renders them without navigation or an account menu.

### Why the route file cannot be removed

Next discovers route handlers from the filesystem and offers no plugin API, so
a package cannot inject one. The file is the irreducible cost — but it is a
re-export, and it does not change when the module gains an action.

### Reading the session

```ts
import { getViewer, getSessionToken } from '@kwtech/module-auth/next';

const viewer = await getViewer();       // Viewer | null — never throws
const token  = await getSessionToken(); // string | null — for §8
```

`getViewer()` returns `null` for **every** failure: no cookie, expired token,
API down, user deleted. A page asking "who is this" wants an answer it can
render; treating "the API is restarting" as a crash takes the whole site down.

It calls `GET /auth/profile`, not `/auth/me` — `/me` returns the token's claims
and would greet someone by their user id. `/profile` reads the user row, so it
also notices an account suspended or deleted since the token was issued.

> **Not a security gate.** `getViewer()` is display. Redirecting on `null` is
> good UX, not protection — enforcement is the API's, on every request. A
> render-time check is something an attacker never runs.

---

## 3. Adding it to a NestJS app

```ts
import { AuthModule, JwtAuthGuard } from '@kwtech/module-auth/server';

AuthModule.forRoot({ prismaProvider: { provide: AUTH_PRISMA, useExisting: PrismaService } });
```

Then make the guard global:

```ts
providers: [{ provide: APP_GUARD, useExisting: JwtAuthGuard }]
```

`useExisting`, **not** `useClass`. `useClass` constructs a second guard in an
injector where `Reflector` is not provided, and the app fails at boot with
"can't resolve dependencies of the JwtAuthGuard".

Global on purpose: authentication is **opt-out**, so a handler nobody annotated
is protected rather than anonymous.

### What you must supply, and why nothing else

| Option | Required? | Why |
|---|---|---|
| `prismaProvider` | in practice | the database client is the app's; no default is possible |
| `sendPasswordResetEmail` | to enable forgot-password | the obvious fallback — log it — writes a working credential into the app's log aggregator. Absent, the endpoint refuses rather than minting a token nobody receives. **Your implementation must not await delivery** — see §6 |
| `mfaSecretKey` | to enable 2FA | encrypts TOTP secrets at rest. Same shape of refusal: absent, enrolment fails rather than storing a symmetric secret in the clear. See §6a |
| `mfaIssuerLabel` | optional | the name an authenticator app shows above the code — "KWTech", not "kwtech-api". Defaults to `issuer` |
| `onAuthFailure` | optional | the endpoint tells the caller nothing; an operator still needs to tell an unknown address from a locked account |
| everything else | no | read from the environment (§4) |

### Endpoints it mounts

`POST /auth/signin` · `/auth/refresh` · `/auth/signout` · `/auth/forgot-password`
· `/auth/reset-password` · `GET /auth/profile` · `/auth/me`

Second factor: `POST /auth/verify-mfa` · `/auth/mfa/enrol` · `/auth/mfa/confirm`
· `/auth/mfa/recovery-codes` · `DELETE /auth/mfa/factors` · `GET /auth/mfa/factors`

⚠️ **Rate limiting is yours.** The module publishes `CREDENTIAL_ENDPOINTS` — the
handlers where a caller is guessing a secret — so the app can point a tight
throttler bucket at them without matching URL strings. See
`apps/web-server/src/auth/credential-throttler.guard.ts` for the reference
implementation and why the decorator could not live in this package.

### Decorators

```ts
@Public('sign-in must work before there is a session')  // opt out of the guard; reason is mandatory
@AllowScopes('pwd_change')                              // restrict which token scopes may enter
handler(@CurrentPrincipal() principal: Principal) {}    // the verified caller
```

`@Public` takes a **reason string** deliberately: an unexplained public endpoint
is indistinguishable in review from one that lost its guard by accident.

---

## 4. Configuration

Defaults are a **published contract**, not a guess: set these names and the
module is configured; pass values explicitly and none of them is read.

| Variable | Entrypoint | Default |
|---|---|---|
| `API_URL` | `/next` | `http://localhost:8080/api/v1` |
| `SESSION_COOKIE` | `/next` | `kwtech_session` (+ `_refresh`) |
| `AUTH_JWT_SECRET` | `/server` | **none — throws at boot** |
| `AUTH_TOKEN_ISSUER` | `/server` | `kwtech-web-server` |
| `AUTH_TOKEN_AUDIENCE` | `/server` | `kwtech-api` |
| `AUTH_SESSION_TTL` | `/server` | `7d` |
| `AUTH_ACCESS_TOKEN_TTL` | `/server` | `15m` |
| `AUTH_PASSWORD_RESET_TTL` | `/server` | `1h` |
| `AUTH_MFA_SECRET_KEY` | `/server` | **none — 2FA enrolment refuses** |
| `AUTH_MFA_ISSUER_LABEL` | `/server` | falls back to `AUTH_TOKEN_ISSUER` |

Durations are `30s` / `15m` / `24h` / `7d`. **A bare number is rejected** — it is
ambiguous between seconds and milliseconds, and `AUTH_ACCESS_TOKEN_TTL=15`
silently meaning fifteen seconds looks like a bug in the app rather than a
configuration error. A malformed value throws; it is never ignored.

`resolveAuthOptions` also rejects a session shorter than the access token it
issues — the stateless token would outlive the revocable row that names it, so
sign-out-everywhere would appear to do nothing for the difference.

`AUTH_MFA_SECRET_KEY` is validated at boot when present — a key of the wrong
length is an operator mistake worth hearing about then, not from the first user
who scans a QR code — but it is **not required** to boot. An app with no 2FA
users has no reason to hold one.

### The secret is the deliberate exception

It has a documented *source*, never a fallback *value*. A module-supplied
default secret would be the same secret in every deployment that forgot to set
one — worse than a failed boot, because nothing ever reports it.

### Overriding

```ts
import { createAuthRouteHandlers } from '@kwtech/module-auth/next';
export const { POST } = createAuthRouteHandlers({ apiUrl, cookieName, secure });
```

`getViewer` and `getSessionToken` take the same overrides. On the Nest side,
anything passed to `forRoot` wins over the environment.

---

## 5. How a token becomes a session

```
browser                Next route handler            Nest API
   │  POST /api/auth/signin   │                          │
   ├─────────────────────────►│  POST /auth/signin       │
   │                          ├─────────────────────────►│  verify credential
   │                          │◄─────────────────────────┤  { accessToken, refreshToken }
   │◄─────────────────────────┤  Set-Cookie ×2, httpOnly │
   │      { ok: true }        │  body carries NO tokens  │
```

**The tokens never reach client JavaScript.** That is the whole design. The API
is a pure bearer service and sets no cookies — no CSRF surface, and a mobile app
uses the identical mechanism — so something on the browser's origin has to turn
a JSON body into an httpOnly cookie. That something is the Next route handler.

The alternative — the sign-in page calling the API and keeping tokens in
`localStorage` — turns any XSS anywhere in the app into full account takeover.

### Two tokens, two jobs

| | Access token | Refresh token |
|---|---|---|
| Lifetime | 15m | 7d |
| Verified by | signature alone, **no database read** | a session row that can be revoked |
| Cookie | `kwtech_session` | `kwtech_session_refresh` |

**The trade this buys, stated plainly:** verification touches no database, which
keeps auth off the hot path — and the cost is that *a revoked session stays
usable until its current access token expires*. At 15 minutes that is a
nuisance. Raising `AUTH_ACCESS_TOKEN_TTL` to a week would make "sign out
everywhere", account suspension and password reset all take a week to bite.
That is the one number to think hard about before changing.

### Token scopes

`full` · `pwd_change` · `mfa`. A step-up token resolves to **no permission
context at all** — otherwise the restricted scope would be decorative.

**The scope is re-derived on every refresh, never carried over.** `refresh()`
reads `AuthSession.mfaSatisfiedAt` and decides again; if it simply reissued the
scope it was handed, a half-admitted user could sign in, wait fifteen minutes,
refresh, and be `full` for having done nothing. That one line is what makes the
`mfa` scope worth anything, and it is the most-tested behaviour in the package.

### Sign-out is two things

1. **Revoke** server-side, so the refresh token is dead.
2. **Clear** the cookies, so this browser stops presenting it.

Doing only (2) is the common bug: anyone who captured the refresh token still
holds a working session for its full week. The cookies are cleared **even when
the revoke call fails** — being stuck signed in on a shared machine is the worse
outcome.

---

## 6. Security properties (do not regress these)

- **The credential path leaks nothing.** One message, one status, and the same
  timing whether or not the address exists (a dummy scrypt runs when it does
  not). Forgot-password answers **202 identically** for a known and an unknown
  address. Anything that makes the two distinguishable — a different status, a
  different message, a measurably faster reply — is an account-enumeration
  oracle.
- **Only unauthenticated actions are proxied.** `PROXIED` is an allowlist. A
  handler that forwarded any path would let the browser reach every endpoint
  with the session attached, which is precisely what the design avoids.
- **`x-forwarded-for` is passed upstream.** The API rate-limits per IP and every
  request reaches it from one server; without this, one user's failed sign-ins
  throttle everyone.
- **Cookies are `httpOnly`, `sameSite=lax`, `secure` in production.** `lax` not
  `none`: the cookie is same-origin, and `none` would send it on any cross-site
  request.
- **`?next=` is honoured only when app-relative.** An absolute URL would make
  the sign-in page an open redirect, sending a freshly authenticated user to an
  attacker's page wearing the trust of having just arrived from yours.
- **Lockout and IP limits are both required.** Lockout alone lets an attacker
  deny service to a named person; an IP limit alone lets a botnet spread guesses
  across accounts. Neither is sufficient. The app supplies the IP half — see the
  `CREDENTIAL_ENDPOINTS` note in §3; this was declared but unwired until
  2026-08-26.
- **A refresh never upgrades a scope.** `refresh()` re-derives it from the
  session row. Reissuing the presented token's scope would let a half-admitted
  user wait out the access token instead of proving a second factor.
- **`sendPasswordResetEmail` must not be awaited by the app's implementation.**
  The endpoint returns immediately for an unknown address; an awaited SMTP round
  trip on the known path is an enumeration oracle in the response time, however
  identical the 202 is. See `apps/web-server/src/auth/reset-mail.ts`.
- **The reset token is handed to `sendPasswordResetEmail` once, raw.** It is not
  stored in that form. If delivery fails the token is gone and the user asks
  again — deliberately.
- **Whatever the app puts in that email must escape its interpolations.** The
  module hands over `SessionUser`, whose `displayName` is free text the account
  holder chose. Concatenated into HTML unescaped it renders as live markup inside
  a genuine, DKIM-signed email — clients strip `<script>`, not anchors. This was
  a real bug in `apps/web-server`; see its `src/mail/README.md` for the fix and
  the template layer that now prevents it.

---

## 6a. Two-factor authentication

TOTP only. `AuthMfaFactorType.webauthn` exists as a value so adding it later is
code and not a migration, and every query pins `type: 'totp'` so a webauthn row
could never make an account owe a factor no endpoint can satisfy.

### The sign-in flow

```
POST /auth/signin            password correct, a CONFIRMED factor exists
  → 200 { scope: 'mfa', mfaRequired: true, accessToken, refreshToken }
      the session row exists; the token reaches /auth/verify-mfa and nothing else

POST /auth/verify-mfa        Authorization: Bearer <that mfa token>
  → 200 { scope: 'full', mfaRequired: false, ... }
      mfaSatisfiedAt is stamped and the refresh token is ROTATED
```

In the browser the same flow is `POST /api/auth/signin` → the page reads
`mfaRequired` → `/auth/verify` → `POST /api/auth/verify-mfa`. The tokens never
leave the httpOnly cookies; the Next handler attaches the session itself, which
is why `verify-mfa` is the one proxied action with `sendsSession: true`.

### Enrolment

```
POST /auth/mfa/enrol     { password, label }  → { factorId, secret, uri }   once
POST /auth/mfa/confirm   { factorId, code }   → { codes: [...] }            once
```

- **The current password is required**, even on a `full` session. A stolen
  cookie must not be enough to add an authenticator the owner does not hold —
  or to strip the one they do, which is why removal requires it too.
- The factor is created **unconfirmed** and grants nothing until a code proves
  it. Without that column, a mis-scanned QR code locks someone out with a factor
  they can never satisfy, and the recovery path is a support ticket.
- Confirming **revokes every other session**. Sessions opened before that moment
  have `mfaSatisfiedAt: null` and would be correctly re-challenged on their next
  refresh — minutes later, with no explanation. "Signed out everywhere else" is
  the honest version of the same thing.
- The module returns the `otpauth://` URI, not a QR image. Rendering is a
  presentation choice, and a package that picked a QR library would decide it
  for every consumer.

### What protects the six digits

| | |
|---|---|
| Replay | `lastUsedStep` is advanced in a **conditional** update, so two requests carrying the same code race in the database, not in application code |
| Drift | ±1 step (±30s) and no more — every extra step multiplies the codes valid at any instant |
| Brute force | MFA failures count towards the **same** lockout as password failures. A separate counter would hand an attacker who already has the password a fresh budget of guesses |
| Storage | AES-256-GCM, key outside the database. See below |

### The secret is encrypted, and cannot be hashed

Everything else this module stores is one-way. A TOTP secret is **symmetric** —
whoever reads it generates valid codes forever — so a stolen dump would defeat
the second factor entirely. `server/secret-box.ts` seals it with AES-256-GCM
under `mfaSecretKey` / `AUTH_MFA_SECRET_KEY`, which deliberately does not live
in the database it protects. GCM rather than CTR or CBC because it
**authenticates**: without a tag a stolen row can be edited, and the verifier
would derive codes from an attacker's secret while reporting nothing unusual.

> ⚠️ **Rotating the key makes every enrolled factor undecryptable.** Those users
> fall back to a recovery code — which is the other half of why
> `AuthRecoveryCode` exists — but it is a support event, not a no-op. Keep it
> separate from `AUTH_JWT_SECRET`: rotating that one to respond to a token
> incident would otherwise lock every 2FA user out.

### Recovery codes

Ten, shown once, hashed with scrypt and single-use via `usedAt`. There is no
"show me my codes" endpoint — the stored values are hashes, and an endpoint that
could answer would mean they were not. `POST /auth/mfa/recovery-codes` issues a
fresh set and invalidates the old one.

Verification scans the user's unused codes one at a time, because a salted
scrypt hash cannot be looked up. Ten hashes is about a second — slow for a
request, and exactly right for a path used once a year: it is a rate limit that
needs no configuration.

### What is deliberately NOT enforced

`AuthUser.mfaRequiredAt` is written and read by nothing. A user who is *required*
but has not *enrolled* cannot satisfy a challenge, so holding them at one is a
lockout with no way forward. Enforcing it needs a fourth `TokenScope` admitting
the enrolment endpoints and nothing else — PLAN §12 decision 17.

Password reset does **not** bypass the second factor, and must not start to:
control of an inbox would otherwise be enough to defeat it.

---

## 7. The pure core

Framework-free, safe in any bundle, and the reason a server, a worker, a CLI and
a React component can share one vocabulary.

```ts
import { normaliseEmail, checkPassword, isLockedOut, MIN_PASSWORD_LENGTH } from '@kwtech/module-auth';
```

Identity: `normaliseEmail` · `normaliseUsername` · `looksLikeEmail` ·
`isPlausibleEmail` · `isPlausibleUsername`
Credentials: `checkPassword` · `MIN_PASSWORD_LENGTH`
Lockout: `isLockedOut` · `nextLockoutState` · `MAX_FAILED_LOGINS` · `LOCKOUT_MS`
Expiry: `isExpired` · `expiryFrom`
Policy defaults: `SESSION_TTL` · `ACCESS_TOKEN_TTL` · `PASSWORD_RESET_TTL`
Second factor: `TOTP_STEP_SECONDS` · `TOTP_DIGITS` · `TOTP_DRIFT_STEPS` ·
`totpStepAt` · `normaliseMfaCode` · `isPlausibleTotpCode` ·
`isPlausibleRecoveryCode` · `RECOVERY_CODE_COUNT`

The TOTP *arithmetic* is here; the HMAC is in `/server`, so a page rendering a
countdown gets `TOTP_STEP_SECONDS` without pulling `node:crypto` into the bundle.

Types: `Principal` · `SessionUser` · `Viewer` · `AuthResult` · `TokenScope` ·
`AuthFailureReason` · `FederatedIdentity` · `IdentityProvider` ·
`MfaFactorSummary` · `MfaEnrolment` · `MfaRecoveryCodes`

`Viewer` is an alias of `SessionUser`, named for the reading side, so the shape
the API returns and the shape a page renders cannot drift.

---

## 8. The seam with `module-permissions`

`module-auth` owns identity; `module-permissions` owns authorisation. **Neither
imports the other**, and each holds the other's ids as bare strings with no
foreign key. That is what keeps an external IdP possible and lets the two live
in different databases.

They meet in exactly **two** places — one per tier. Do not add a third.

**Server** — `apps/web-server/src/auth/resolve-principal.ts`:

```ts
resolvePrincipal(request) // Principal on the request → { userId } for permissions
```

Returns a userId **only** when `principal.scope === 'full'`, so a step-up or
reset token grants nothing anywhere.

**Web** — one line in the app shell:

```ts
const token = await getSessionToken();                    // module-auth/next
const context = await getPermissionContext({ token });    // module-permissions/next
```

`getPermissionContext` takes a **token**, not a cookie name: it must not import
this module and would be guessing if it picked one. Its `null` **fails closed** —
treat it as "holds nothing", never as "skip the filter".

---

## 9. Database

Ships `prisma/auth.prisma` as a **fragment**, composed into the app's schema by
file copy (see `apps/web-server/scripts/compose-schema.mjs`). A package import in
that direction would close a cycle: the app's schema would depend on the module,
and the module must never depend on a db package.

Models are prefixed `Auth*` / `auth_*` so a fragment drops into any schema
without colliding:

| Model | State |
|---|---|
| `AuthUser` | in use |
| `AuthCredential` | in use |
| `AuthSession` | in use — the revocable row a refresh token names |
| `AuthPasswordReset` | in use |
| `AuthMfaFactor` | in use — `totp` only; `webauthn` is a reserved enum value |
| `AuthRecoveryCode` | in use |
| `AuthIdentity` | **schema only** — federated sign-in, §10 |

`AuthUser.mfaRequiredAt` is written by nothing and read by nothing — see §6a,
"What is deliberately NOT enforced".

Adding the module to a server app is a line in that script's `MODULES` array
plus the `forRoot` call.

---

## 10. Federated sign-in — schema only

`AuthIdentity` exists; **nothing implements Google or Microsoft yet** (deferred
2026-08-25). When it is built:

- Match on the provider's **`subject`** claim, never on email. Email is
  reassignable and, at some providers, unverified — matching on it is account
  takeover by password reset at the IdP.
- `emailVerifiedByProvider` gates auto-linking to an existing account.

---

## 11. Extending it

**A new endpoint the browser may reach** — add it to `PROXIED` in
`src/next/route-handlers.ts` *and* to the controller. It is an allowlist; that is
the point. Ask first whether the browser should reach it at all, or whether the
app's own server should call it with the session.

**A new page** — add a `ModuleRoute` to `authWebModule` in
`src/react/module.tsx`, set `chrome: 'bare'` if it is reachable while signed
out, and give it a `nav` entry only if a signed-in user should be offered it.

**A new option** — make it optional and default it in `resolveAuthOptions`,
unless it is a secret.

**Barrels use NAMED re-exports, never `export *`.** `export *` compiles to
`__exportStar`, which copies keys with `for...in`; Next replaces a `'use client'`
module with a proxy that does not answer that enumeration, so the re-export
yields nothing and fails at render with "Element type is invalid", pointing
nowhere near the barrel. This has already cost one debugging session.

**Route handlers use Web `Request`/`Response`, not `next/server`.** A
`require("next/server")` inside a package that goes through
`transpilePackages` becomes a binding that is not there —
`ReferenceError: server_1 is not defined`, on the first request rather than at
build. See `src/next/cookies.ts`.

---

## 12. Troubleshooting

| Symptom | Cause |
|---|---|
| `AuthModule.forRoot: no JWT secret` at boot | `AUTH_JWT_SECRET` unset and none passed. Working as intended — there is no fallback value. In this repo the variable was **renamed from `JWT_SECRET`** on 2026-08-25, so an environment carrying the old name hits exactly this. |
| Sign-in returns 200, page still signed out | Soft navigation after sign-in. The cookie is httpOnly, so only the server sees it — navigate with a **full** page load. |
| `Element type is invalid: … got: undefined` | An `export *` barrel over a `'use client'` module. §11. |
| `ReferenceError: server_1 is not defined` | Something imported `next/server` inside the package. §11. |
| Pages render unstyled, or a card stretches full-width | Tailwind ignores `node_modules`, so the app needs an `@source` covering this package's `src` — **with a file pattern**: `packages/*/src` matches nothing, `packages/*/src/**/*.{ts,tsx}` works. Partial breakage looks like layout drift, because classes the app also uses still resolve. Probe the built CSS with a package-only class such as `max-w-sm`. |
| Revoked session still works | Expected for up to `AUTH_ACCESS_TOKEN_TTL`. §5. |
| Auth pages show the app shell | The route lost `chrome: 'bare'`. |
| `AuthModule.forRoot requires mfaSecretKey` at enrolment | `AUTH_MFA_SECRET_KEY` unset. Working as intended — the feature is off rather than storing a symmetric secret in the clear. `openssl rand -base64 32`. |
| Sign-in succeeds but the app still says signed out, for 2FA users only | The page ignored `mfaRequired`. The cookie holds an `mfa` token, which `resolvePrincipal` correctly grants nothing for. §6a. |
| Every code is rejected right after enrolling | Server or phone clock drift beyond ±30s, or the authenticator ignored `algorithm=SHA1`. Check the server clock first — it is the one that affects everyone. |
| A code works once then "fails" on retry | Working as intended: `lastUsedStep` makes a code single-use. Wait for the next one. |
| Reset emails never arrive in production | The app fails to boot without `SMTP_URL`, so this is a verified-sender problem: an unverified `MAIL_FROM` is not rejected, it is filed as spam. |
| `429` from the API | Credential throttle bucket, 10/min per IP. |

---

## 13. Tests

`pnpm --filter @kwtech/module-auth test` — 138 tests over policy, password
hashing, the token service, the auth service and option resolution. The
option-resolution suite exists to keep the two-line setup honest: it boots
`AuthModule.forRoot({})` from the environment alone and asserts that a missing
secret still throws.
