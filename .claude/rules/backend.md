---
paths:
  - "apps/web-server/**"
  - "packages/*/src/server/**"
---

# Standards: backend (NestJS, GraphQL, authorization)

Reference: `packages/module-queuing-window/src/server/` and
`apps/web-server/src/queue/`.

## Nest modules and DI

- **A module exports `xServerModule(options): ServerModuleDescriptor`**, returning
  `{ key, nestModule: XModule.forRoot(options), features, limits }` (`server-module.ts`).
- **`XModule` is `@Module({})` with `static forRoot(options = {}): DynamicModule`.**
  It provides `X_OPTIONS`, the services, and the host's `prismaProvider` /
  `prismaWriteProvider`. Resolvers are added only when
  `options.expose?.graphql ?? true`.
- **Optional ports are bound to `undefined`, never left out.** Consumers use
  `@Optional() @Inject(TOKEN)` and fall back to a null object (`NULL_QUEUE_PUBSUB`)
  whose behaviour is documented in `x.options.ts`.
- **Tokens are strings** in `x.tokens.ts`: `QUEUE_PRISMA = 'kwtech:queue-prisma'`.
  **Legacy — do not copy:** auth and permissions declare tokens inside `*.repository.ts`.
- **New modules are NOT `global: true` and expose no REST.** Auth and permissions
  are global with REST controllers for historical reasons.
- **Register in the app:** add the descriptor to `SERVER_MODULES` in
  `apps/web-server/src/app.module.ts`. Bind ports with `useFactory` + `inject`.
  Use `useExisting` for shared singletons.
- **Never import a Nest-injected class with `import type`.** It erases DI metadata.
- **Nest, `@nestjs/graphql` and `graphql` come from the pnpm `catalog:`.** A second
  copy breaks `instanceof HttpException` (every 4xx becomes a 500) and the GraphQL
  metadata registry.

## Data access

- **`x.repository.ts` is not a class.** It declares `*Row` interfaces and a
  structural client interface listing only the delegate methods and argument
  shapes the services actually send. Modules never import `@prisma/client`.
- **`XService` reads through `@Inject(X_PRISMA)`; `XWriteService` writes through
  `@Inject(X_PRISMA_WRITE)`.** One service per file. There is no separate
  repository layer.
- **Transactions use only the interactive callback form:**
  `prisma.$transaction(async (tx) => …)`. `XTransaction` is the client without
  `$transaction`. Keep them short, and never publish or send mail inside one.
- **The app binds the clients** in `apps/web-server/src/prisma/module-clients.ts`:
  - read: `useExisting: PrismaService`
  - write: `withTransaction<Tx, Client>(prisma, { delegate: prisma.delegate, … })`
  
  Add the compile-time fit check to `satisfies-modules.ts`.
- **A unique violation (`P2002`, detected structurally) becomes a domain refusal**,
  not a 500.

## GraphQL (code-first)

- **Files:** `src/server/graphql/x.resolver.ts` + `x.types.ts`. `@Resolver()` takes
  no type argument.
- **Every operation has an explicit `name`** containing the module noun:
  - queries are nouns: `queueConsole`, `chatMessages`
  - mutations lead with a verb: `startQueue`, `callNextQueueTicket`, `sendChatMessage`
- **Types:** `@ObjectType('QueueTicket') export class QueueTicketType`,
  `@InputType('QueueVoiceInput') export class QueueVoiceInputType`. Fields use `!`.
  Give nullable and `Int` fields an explicit type:
  `@Field(() => String, { nullable: true }) calledAt!: string | null`.
- **One `@Args('name')` per argument.** Optional args need an explicit type:
  `@Args('x', { type: () => String, nullable: true })`. Group many optional args
  in an `@ArgsType` / `@InputType` class, because inline optional args fail at boot.
- **Return the object type directly.** No payload wrappers, no unions.
  - Use `Boolean` for fire-and-forget mutations.
  - Use `nullable: true` when "absent or refused" is a normal answer.
- **No `registerEnumType` and no custom scalars.** Enums cross as documented
  `String` fields, and dates as ISO strings. Map rows with module-local
  `renderX(row)` functions.
- **Validate in services or domain functions, never in resolvers.** Resolvers read
  the actor, call a service, and render.
- **Pagination:** new list endpoints use the chat shape: an opaque keyset `cursor`
  + `limit`. **Legacy:** permissions uses `limit`/`offset` page types, and auth
  admin uses `skip`/`take`.
- **Every document the client sends lives in the module's `src/operations.ts`.**
  Add the module to `MODULE_OPERATIONS` in
  `apps/web-server/test/module-operations.test.ts`, which validates it against
  the committed `apps/web-server/schema.graphql`. That file is regenerated at
  boot; commit its diff.

## Authorization

- **Global guard order:** `JwtAuthGuard` → `CredentialThrottlerGuard` →
  `FeatureGuard` (`app.module.ts`).
- **Every resolver class below app level declares its scope:**
  `@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))`. Without it
  the guard resolves at app level and the module's keys grant nothing, with no
  error.
- **Features:** in permissions and app code, use `@RequireFeature(KEY)` +
  `@RequireScope(...)`. In every other module, the registry `bindings` are the
  guard. The module must also be in `MODULE_DECLARATIONS`
  (`apps/web-server/src/seed/registry.ts`), or its operations are unguarded.
- **Public surfaces go in their own resolver class** with
  `@SetMetadata(PUBLIC_SURFACE_METADATA, '<non-empty reason>')`. Where a secret or
  code is guessed, add `CREDENTIAL_SURFACE_METADATA`. Auth and app code use
  `@Public('reason')`.
- **Services re-check record-level authority themselves** (seat ownership,
  participation). The guard is only the fast refusal. Record-level access is
  never a feature key.
- **Guard order of refusals:** 401 unauthenticated → scope mismatch (reads as
  not-found) → `no_workspace_access` → declared scope → feature.

## Errors

- **Newer modules throw `XWriteError(reason, message, detail)`** from services.
  Map reasons to messages in one exhaustive `switch`.
- **Nest HTTP exceptions** (`BadRequestException`, `ForbiddenException({ message,
  reason })`) belong in transport code: controllers, guards, auth.
- **Known gap:** `formatError` strips `extensions` in production, so clients get
  the message but not the reason. Do not build client logic on `reason`
  arriving until PLAN §12 settles it.
- **Enumeration-sensitive paths return ONE refusal** (`null` or one message) for
  every failure.

## REST

- **REST only for auth token flows, permissions' `me`/features, and health.**
  Everything else is GraphQL.
- **Bodies are inline type literals** (`@Body() body: { email: string }`). There is
  no ValidationPipe (open decision §12.6), so the service validates.

## Config

- **`apps/web-server/src/config/env.ts` is a zod schema parsed at import.** A bad
  value stops the boot with one line.
  - `optionalText` treats empty as absent.
  - Use `.refine` for production-only requirements and `z.coerce.number()` for
    numbers.
  - Document every variable in `.env.example`.
- **Env files are profiles:** `envs/<name>/web-server.env`, linked to `.env` by
  `pnpm env:use`. A new variable goes into `.env.example`, EMPTY if it is a
  secret or personal (`*_PASSWORD|*_SECRET|*_KEY|*_EMAIL`; the pre-commit check
  refuses a value), and into `env.ts`. New profiles pick it up from the
  template, and `pnpm env:check` lists existing profiles that lack it.
- **`APP_ENV` (`local` | `staging` | `production`) is WHICH environment, and
  `NODE_ENV` is HOW it was built.** A command that must never run against real
  data guards on `APP_ENV`: `node ../../scripts/env.mjs --require=local` in the
  package script, or `env.APP_ENV` in code.
- **Modules read `options.x ?? process.env.X` and never default a secret.** When
  the app's schema computes a fallback, pass it to the module explicitly; a zod
  default never reaches `process.env`.

## Operations

- **Logging:** `new Logger('Context')`, with no custom logger. Log auth failures
  as structured `warn`.
- **Throttling:** two buckets. `default` is `THROTTLE_DEFAULT_LIMIT`. `credential`
  is 10/min and applies to credential endpoints and
  `CREDENTIAL_SURFACE_METADATA` handlers. Modules never depend on
  `@nestjs/throttler`.
- **Mail is the app's job**, reached by modules through a callback or port.
  Templates are `apps/web-server/src/mail/templates/*.html|txt` rendered by
  `renderEmail`. With no `SMTP_URL`, log the link instead of sending.
