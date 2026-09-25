# Coding standards

The standards live in [`.claude/rules/`](../.claude/rules/). Claude Code loads
them on its own: `00-principles.md` at the start of every session, and each
topic file as soon as Claude reads a file its `paths:` globs match. Nobody has to
ask for them. They are written to be read by people too.

| File | Covers | Loads for |
|---|---|---|
| [00-principles.md](../.claude/rules/00-principles.md) | architecture principles, security, "done", which pattern wins | always |
| [typescript.md](../.claude/rules/typescript.md) | conditions, iteration, functions, naming, types, errors, imports, comments | `**/*.{ts,tsx,mjs}` |
| [modules.md](../.claude/rules/modules.md) | module package layout, registries, ports, realtime, README | `packages/module-*/**` |
| [backend.md](../.claude/rules/backend.md) | NestJS, DI, data access, GraphQL, authorization, errors, config | `apps/web-server/**`, `packages/*/src/server/**` |
| [database.md](../.claude/rules/database.md) | Prisma fragments, migrations, seeders, the snapshot | `*.prisma`, `apps/web-server/{prisma,src/seed,seed-data}/**` |
| [frontend.md](../.claude/rules/frontend.md) | Next.js, components, data hooks, gating, forms, styling, a11y, copy | `apps/web-app/**`, `packages/*/src/{react,next}/**`, `packages/web-ui/**` |
| [testing.md](../.claude/rules/testing.md) | Jest, fake clients, standard suites, Playwright | `test/**`, `*.test.ts`, `e2e/**` |

[`CLAUDE.md`](../CLAUDE.md) keeps the commands and the add-a-feature checklist.

Most of these rules are checked by review. The package boundaries are the
exception: [`DEPENDENCIES.md`](DEPENDENCIES.md) maps them, and
`pnpm check:boundaries` (the last step of `pnpm lint`) fails on a violation.

## Where the rules came from

They were extracted from the code on 2026-09-25, not adopted from an outside
style guide. Every rule states what the code already does in most places. For
example, early returns outnumber `else` about 1165 to 4, `for...of` outnumbers
`forEach` 101 to 2, there are zero `enum`s and zero `any`, and there are zero
JSX `&&` against 250 `? … : null`. Where the code does something two ways,
**the newest module wins** (`module-queuing-window`, then `module-chat`). The
older way is marked **Legacy — do not copy**.

## Changing a standard

Edit the rule file in the same change as the code that motivates it, and say
why in the commit. A rule the code no longer follows is worse than no rule: fix
one or the other. Keep each file short. Claude follows short, specific rules
better than long ones, and everything in `00-principles.md` costs context in
every session.

## Known inconsistencies (the backlog)

The code does these two ways today. New code follows the first; the second is
legacy, to be converged deliberately, not as a side effect.

| # | Standard | Legacy | Where |
|---|---|---|---|
| 1 | GraphQL documents in `src/operations.ts`, validated against the schema | inline query strings (unvalidated) | module-auth, module-permissions clients and some components; `apps/web-app/.../accept-invitation.tsx` |
| 2 | `src/feature-keys.ts` | `src/features.ts` | module-auth |
| 3 | tokens in `x.tokens.ts` | tokens in `*.repository.ts` / `*.pubsub.ts` | module-auth, module-permissions |
| 4 | separate read / write Prisma clients | one client | module-auth |
| 5 | one `XTransaction` shape | `Tx = Omit<WriteClient, '$transaction'>` vs Tx-as-base | chat/permissions vs queue |
| 6 | `XWriteError(reason)` from services | Nest HTTP exceptions from services | module-auth, app code |
| 7 | keyset `cursor` + `limit` pagination | `limit`/`offset`, `skip`/`take` | permissions, auth admin |
| 8 | `XInputType` class names | `XInput` | module-permissions |
| 9 | not global, GraphQL only | `global: true` + REST controllers | module-auth, module-permissions (partly by design) |
| 10 | `bg-status-*` utilities, tokens only | `bg-[var(--status-*)]` (15 files), raw colours (4) | several react files |
| 11 | one `Field` / button style | `Field` + `inputClass` copied into 6 forms; inline button styles | module-permissions forms |
| 12 | `ConfirmDialog` | `window.confirm` | `accept-invitation.tsx`, `user-detail-page.tsx` |
| 13 | `useHoldsFeature` (module-kit) | `useHasFeature` / `FeatureGate` outside module-permissions | — |
| 14 | seeders read validated env | `process.env.SEED_*` directly | `apps/web-server/src/seed/seeders/*` |
| 15 | one mail transport | nodemailer setup copied 3× | `apps/web-server/src/{auth,permissions,chat}/*-mail.ts` |
| 16 | `aria-invalid` / `aria-describedby` on fields | missing | all forms |

## Gaps that may be bugs (not style), found while writing this

- **`formatError` strips `extensions` in production** (`apps/web-server/src/graphql/graphql.options.ts`),
  so a domain error's `reason` never reaches the client there.
- **`signUpFromInvitation` and `declineInvitation` are public and take a token but
  carry no credential marker** (`apps/web-server/src/invitations/invitations.resolver.ts`),
  so they get the default throttle rather than the credential one.
- **Next 16 renamed `middleware.ts` to `proxy.ts`.** The app still uses
  `middleware.ts`.
