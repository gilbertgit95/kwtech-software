---
paths:
  - "packages/module-*/**"
  - "packages/module-kit/**"
---

# Standards: module packages

The adding-a-feature checklist is in `CLAUDE.md`. This file is the shape of a
module and the rules behind that checklist. **Reference implementation:
`packages/module-queuing-window`.** Copy its layout file for file.

## Layout

```
src/index.ts            pure root: types, feature keys, domain, operations. NO framework imports
src/types.ts            shared shapes (views, refusal unions)
src/feature-keys.ts     X_FEATURE, X_FEATURE_REGISTRY, X_LIMIT, X_LIMIT_REGISTRY, X_ROLE_PRESETS
src/operations.ts       X_OPERATIONS: every GraphQL document the client sends
src/domain/*.ts         pure decisions, and where the unit tests point
src/server/             → "./server"
  index.ts  x.module.ts  server-module.ts  x.options.ts  x.tokens.ts  ports.ts
  x.repository.ts  x.service.ts  x-write.service.ts  x.errors.ts  x.events.ts  x.pubsub.ts
  graphql/x.resolver.ts  graphql/x.types.ts
src/react/              → "./react"   ('use client' components, never imports /server)
  index.ts  module.tsx  routes.ts  x-client.ts  use-*.ts  pages/*-page.tsx  components/  view/*.ts
prisma/x.prisma         → "./prisma"  the schema fragment
test/                   fake-client.ts, surface-coverage, feature-keys, web-module, *.realtime tests
```

- **`/next` exists only where a module ships Next route handlers or middleware**
  (auth, permissions).
- **Legacy — do not copy:**
  - `module-auth` names its registry file `src/features.ts`.
  - `module-auth` and `module-permissions` inline GraphQL documents in clients
    and components instead of `src/operations.ts`. Those documents escape
    schema validation.
  - PLAN §9's diagram showing `src/graphql/*.graphql` is out of date.

## package.json

- `"private": true`, `"version": "0.0.0"`, `"type": "module"`, `"sideEffects": false`,
  `"files": ["dist", "prisma"]`.
- **exports:** `"."`, `"./server"` and `"./react"`, each as
  `{ "types": "./dist/…d.ts", "default": "./dist/….js" }`. `"./prisma"` points
  at the raw `.prisma` file.
- **dependencies:** only `@kwtech/module-kit` (`workspace:*`) plus true runtime
  libraries. Never another `@kwtech/module-*`.
- **peerDependencies**, all optional in `peerDependenciesMeta`: `@nestjs/common`,
  `@nestjs/graphql`, `reflect-metadata`, `react`, `@kwtech/web-ui`. The same
  packages are devDependencies via `catalog:`.
- **Scripts:** build `tsc -p tsconfig.json`; dev `tsc --watch`; typecheck `tsc
  --noEmit && tsc -p tsconfig.test.json`; `lint`: `biome check .`; `test`: `jest`.
- **tsconfig:** `tsBuildInfoFile: "dist/.tsbuildinfo"` is required. Anywhere else,
  `rm -rf dist` leaves tsc emitting nothing.

## Naming inside a module

- **Prefix everything:** `Queue*` models, `queue_*` tables, `queue:*` feature keys,
  `QUEUE_*` constants, `'kwtech:queue-*'` tokens, `queue.*` events, and GraphQL
  names containing the module noun (`queueConsole`, `startQueue`).

## Registries (declared in code, mirrored by `db:sync`)

- **Feature keys are `<module>:<verb_noun>` in snake_case** (`queue:assign_windows`).
  Export `X_FEATURE = { … } as const` and its type. Split keys by risk (start vs
  stop), so a key never bundles a low-risk and a high-risk act.
- **Each registry entry has** `key`, `module`, `level` (`app` | `organization` |
  `workspace`), `label`, `description`, and `bindings`. List a binding only once
  its guard exists.
- **Bindings ARE the guard for modules that cannot use `@RequireFeature`** (every
  module except permissions and auth). `surface-coverage.test.ts` must stay
  green: every operation is bound, or listed as deliberately unbound with a
  reason. An unbound operation skips the membership check.
- **Limits** (how many) go in `X_LIMIT_REGISTRY` with `source` (`plan` | `role`),
  `countedOver` and `defaultValue`. A `null` default means unlimited for everyone
  who is not configured, which is almost never right.
- **Role presets** (`X_ROLE_PRESETS`) are exported as data. The module never seeds
  them. The app's `seed/app-roles.ts` and `seed/plans.ts` read them, so adopting a
  module grants nobody anything until the app decides.
- **Defaults are keyed by the process they serve** (`chat.creator_role`), and
  `whenUnset` is required. Renaming a key is a data migration.
- **Composition throws on a duplicate route path or key.** Never catch that.

## Cross-module boundaries

- **Every question about another module's data is a port:** a structural interface
  in `server/ports.ts` plus a string token in `x.tokens.ts`.
- **The JSDoc on each token says what UNBOUND means, and unbound fails closed**
  ("no display can open", "not live").
- **The app implements the port** in `apps/web-server/src/<module>/*.ts` and binds
  it through `xServerModule({ … })` in `app.module.ts`.
- **The actor comes from the request, proven by the app's guard**
  (`options.resolveActorId(req)`). A module never resolves identity itself.
- **If two modules need the same shape, copy it structurally**, and say so in a
  comment. It moves to `module-kit` only when a second consumer exists.
- **Telling people something is `module-notification`'s job, reached by a
  port.** A module declares `X_NOTIFIER` (its own words: "session stopped"),
  calls it after the commit without letting it fail the write, and the app's
  adapter turns that into `NotificationSender.sendSafely(...)` with a declared
  source. Never import `module-notification`, and never build a module's own
  toast or badge. See its README, "Notifying people from another module".

## Realtime

- **Declare event names once, as data:** `X_EVENT = { call: 'queue.call', … }`.
  Use a few global triggers, not one per tenant. The payload carries
  `organizationId` / `workspaceId`, and the subscriber filters.
- **Payloads are JSON-safe** (ISO strings, not `Date`), because Redis may carry them.
  An event may carry no rows; the client then re-reads through the guarded query.
- **Publish AFTER the commit, through `XEventPublisher`.** A publish failure is
  logged and never fails the write.
- **Server side:** `@Subscription(..., { resolve: (p) => p })` is required, or
  clients get `data: null`. Resolve the actor at subscribe time. Wrap the stream
  in `withCatchUp` (it emits `sync` first, because there is no replay) and filter
  per publish in `transform`. Bind it as `graphql_subscription`.
- **Client side:** `useRealtime()` returns `null` when not live. Subscribe, then
  debounce and re-read (`REREAD_DEBOUNCE_MS = 200`). Clear the timers on unmount.
- **If a payload ever carries personal data, filter the audience per publish**, as
  chat does.

## README (update with every contract change)

Sections in this order: "In a Next.js app" → "In a NestJS app" (options, ports,
what unbound means) → Realtime → Vocabulary → the domain entry point →
feature-specific sections → "What it declares".
