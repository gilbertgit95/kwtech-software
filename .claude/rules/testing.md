---
paths:
  - "**/test/**"
  - "**/*.test.ts"
  - "apps/web-app/e2e/**"
  - "**/jest.config.mjs"
  - "**/playwright.config.ts"
---

# Standards: tests

## Unit tests (Jest 30 + @swc/jest)

- **Tests live in `<package>/test/*.test.ts`**, named by topic
  (`tickets.test.ts`, `queue-write.service.test.ts`). They are not colocated
  with the source.
- **Jest config:** `moduleNameMapper` strips `.js`, so tests run against `src/`.
  Packages add `setupFiles: ['reflect-metadata']`.
- **Test the domain first:** pure functions with object literals and a fixed
  `now: Date`. Most tests in the repo are these.
- **Services are tested against `test/fake-client.ts`, never a real database.**
  The fake enforces the `@@unique` constraints (raising `P2002`), rolls back
  failed transactions, and throws on any query operator it does not support.
  Extend the fake when a service needs a new operator, rather than weakening it.
- **There are no React render tests.** UI rules live in `src/react/view/*.ts` and
  are tested as pure functions. Structural rules (every chat sub-page uses the
  frame) are tested by reading the source.
- **Each module has these standard suites; keep them green and extend them:**
  - `surface-coverage.test.ts`: every operation is bound or deliberately unbound.
  - `feature-keys.test.ts`: the registry's shape.
  - `web-module.test.ts`: the descriptor.
  - `*.realtime.test.ts`: event filtering.
- **In the app** (`apps/web-server/test/`):
  - `module-operations.test.ts` validates every module's `operations.ts`
    against `schema.graphql`.
  - Resolver, ws-context and pubsub tests.
- **Name tests by behaviour** ("refuses a stop from a non-owner"), and assert
  the refusal reason, not just that something threw.
- **A bug fix comes with the test that would have caught it.**

## E2E (Playwright, `apps/web-app/e2e/`)

- **Runs against a stack you start:** a built app on :8081, `workers: 1`.
  `test.skip(!configured, reason)` when the `E2E_*` env vars are missing.
- **Select by role and accessible name** (`getByRole('button', { name, exact })`,
  `getByLabel`). There is no `data-testid`.
- **Set up through `page.evaluate(() => fetch('/api/auth/graphql', …))`**, not
  `page.request`, because the cookies are Secure.
- **Data is idempotent and marked** (a `Z9` prefix), and archived in `finally`.
