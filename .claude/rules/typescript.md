---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.mjs"
---

# Standards: TypeScript (every file)

Compiler: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`, `isolatedModules`, NodeNext,
ES2023 (`tsconfig.base.json`). Formatting and import order belong to Biome
(`biome.jsonc`): 2 spaces, width 120, single quotes, semicolons, trailing commas.
Do not hand-format against it.

## Conditions

- **Use guard clauses and return early.** `else` after a `return` or `throw`
  does not appear in this code (about 1165 `if`s against 4 `else`s).
  ```ts
  if (!ticket) return 'not_found';
  if (ticket.status !== 'called') return 'not_called';
  return null;
  ```
- **A one-statement guard goes on one line without braces:** `if (!x) return null;`.
  Use braces once the body has more than one statement.
- **`switch` over a string-literal union**, with no `default`. Exhaustiveness
  comes from the declared return type: a missing case fails the compile.
  Use `case 'x': {` blocks when a case declares locals.
  Example: `packages/module-queuing-window/src/domain/tickets.ts`.
- **Ternaries are single-level in logic.** Break long ones with a leading `?` / `:`.
  Nested ternaries are tolerated only for short JSX labels.
- **Use `??` for defaults, never `||`** (an empty string and `0` are values). Use `?.` freely.
- **Null checks:** use a truthiness guard (`if (!id)`) when an empty string or 0 is
  also invalid. Compare explicitly (`=== null`) when `null` is a meaningful
  result. Use `== null` only to catch null and undefined together, deliberately.
- **With `noUncheckedIndexedAccess`, `arr[0]` is `T | undefined`.** Handle it:
  `errors[0]?.message ?? 'Fallback.'`. Never silence it with `!`.

## Iteration

- **Use `for...of` for side effects, and never `forEach`** (2 legacy uses).
  There are no `for...in` loops.
- **Use `.map` / `.filter` for transforms.** Use `reduce` only for a trivial sum
  or pick; otherwise a `for...of` with an accumulator reads better.
- **Use an indexed `for (let i = 0; …; i += 1)` only for numeric work**: grids,
  retries, reverse scans. Write `+= 1`, not `++`.
- **Async:** run independent work in parallel with `const [a, b] = await Promise.all([...])`.
  Use sequential `await` inside `for...of` only when order or a transaction
  requires it, and say which in a comment.

## Functions

- **Use `function` declarations**, top-level and for React components. Use arrows
  for inline callbacks, and for one-line decorator factories
  (`export const Public = (reason: string) => SetMetadata(...)`).
- **Annotate the return type on every exported or domain function.** Leave it off
  React components and hooks.
- **Parameters:** 1–3 positional inputs for domain functions. Beyond that, use
  one options object with defaults (`options: XOptions = {}`). Narrow inputs with
  `Pick<>`: `ticket: Pick<TicketView, 'status' | 'windowId'>`.
- **Use `async` / `await`, not `.then`** (except inside React effects).
- **Pass time in:** domain functions take `now: Date`, and services create
  `const now = new Date()`. That is what makes them testable.
- **Keep decisions in small pure functions in `domain/*.ts`, and I/O in services.**
  Domain verb prefixes:
  - `check*` returns a refusal reason or `null`.
  - `plan*` returns a discriminated plan (`{ kind: … }`).
  - `prepare*` returns a value or `{ refused }`.
  - `next*` steps a state machine.
  - `is*` / `has*` / `can*` return booleans.
- **Outside Nest, build with factories instead of classes:**
  `createQueueClient()` returns an interface-typed object. The only non-Nest
  classes are `Error` subclasses.

## Naming

- **Files are kebab-case.** Nest roles take suffixes: `.service.ts`, `.resolver.ts`,
  `.module.ts`, `.types.ts`, `.repository.ts`, `.tokens.ts`, `.errors.ts`,
  `.events.ts`, `.pubsub.ts`, `.options.ts`, `.guard.ts`. Hooks are `use-*.ts` and
  API clients `*-client.ts`.
- **Use `interface` for object shapes** (including `*Props`), with no `I` prefix.
  Use `type` for unions, aliases and mapped types.
- **Never use `enum`.** Use snake_case string-literal unions:
  `type QueueRefusal = 'not_found' | 'not_permitted' | …`.
- **Module-level constants, registries and messages are UPPER_SNAKE.** Put the unit
  in the name or its doc: `REREAD_DEBOUNCE_MS`, or `SESSION_TTL` with "Seconds.".
- **DI tokens are string constants** `X_THING = 'kwtech:x-thing'`, never Symbols.

## Types

- **Never use `any`.** Use `unknown` and narrow structurally:
  `typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'`.
- **Use `as` only to narrow**, for example a wire `string` to a known union. When the
  reason is not obvious, justify the cast in a comment. Avoid `as unknown as` and
  never use non-null `!`.
- **Use `as const` on registries and lookup objects.** Use `satisfies` to check a
  literal against a union without widening it.
- **Prefer `readonly T[]` in parameters and return types.**
- **Model results and plans as discriminated unions on `kind`**, handled with `switch`.
- **Because of `exactOptionalPropertyTypes`**, omit an optional property rather
  than passing `undefined`. Declare `x?: T | undefined` when a value may be
  forwarded as undefined.
- **Zod validates env and nothing else.** Ids are plain `string` (cuid).

## Errors

- **An expected refusal is a value, not an exception.** Return a reason or `null`,
  `{ refused: reason }`, or `{ ok: false, reason }`.
- **At a module's service boundary, throw that module's one error class**, which
  carries a snake_case reason union:
  ```ts
  export class QueueWriteError extends Error {
    constructor(readonly reason: QueueRefusal, message: string, readonly detail: Record<string, unknown> = {}) {
      super(message);
      this.name = 'QueueWriteError';
    }
  }
  ```
- **Use `throw new Error(...)` for misconfiguration and bugs**, and name the fix:
  "AuthService needs a client. Bind AUTH_PRISMA via prismaProvider in AuthModule.forRoot."
- **User-facing messages are plain full sentences** with no codes. They say why,
  and use `…` and `—`.
- **`catch {` when the error is unused, `catch (error)` otherwise.** Never annotate
  it and never swallow it silently: log it, map it, or rethrow it.

## Imports and exports

- **Named exports only.** `export default` exists only where Next requires it
  (`page.tsx`, `layout.tsx`).
- **Relative imports end in `.js`.** Node built-ins use the `node:` prefix.
- **Use `import type` for type-only imports, and inline `type` in mixed imports** —
  EXCEPT in `**/src/server/**` and `apps/web-server/src/**`. There, a Nest-injected
  class must stay a value import or its DI metadata is erased (Biome's
  `useImportType` is off there on purpose).
- **Each entry point has an `index.ts` barrel** of `export * from './x.js'`, headed
  by a JSDoc that states what that entry point may import.
- **Never deep-import another package's `src/`.** Use its public subpath exports.

## Comments

- **Comments explain WHY and name the failure they prevent**, never what the next
  line does. JSDoc every export. This code comments heavily; match it.
- `⚠` marks an invariant or trap. Cross-reference decisions as `PLAN §12.58`.
  State rejected alternatives: "The alternative — … — would mean …".
- **No `TODO` / `FIXME`.** A known gap is written as prose and, if real, entered in
  PLAN §12.
- **Deprecation:** `/** @deprecated Read X instead; kept so … */`.

## Immutability

- **Use `const`.** `let` only for accumulators, try-then-assign around a
  transaction, and module singletons (with a comment on why DI is not used).
- **Build new objects with spread; don't mutate inputs.** Pure domain functions
  return a patch (`editPatch(...)`). `.push` into a local fresh array is fine.
- **Dates:** no date library. Use `Date`, `Date.now()`, and `.toISOString()` on
  the wire. Durations are integer constants in seconds, or with an `_MS` suffix.
  Random tokens use `node:crypto` `randomBytes`, and client ids use
  `crypto.randomUUID`.
