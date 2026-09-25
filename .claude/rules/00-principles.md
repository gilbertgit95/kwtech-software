# Standards: principles (always loaded)

These rules are how this repository is ALREADY written. They were extracted from
the code, not imported from a style guide. Topic rules load on their own when
you touch matching files:

| File | Loads for |
|---|---|
| `typescript.md` | every `.ts` / `.tsx` / `.mjs`: conditions, loops, functions, naming, types, errors |
| `modules.md` | `packages/module-*/**`: package layout, registries, ports, realtime |
| `backend.md` | `apps/web-server/**`, `packages/*/src/server/**`: NestJS, GraphQL, auth, errors |
| `database.md` | Prisma fragments, migrations, seeders, the snapshot |
| `frontend.md` | `apps/web-app/**`, `packages/*/src/{react,next}/**`, `packages/web-ui/**` |
| `testing.md` | `test/**`, `*.test.ts`, `apps/web-app/e2e/**` |

Humans: the overview and the list of known inconsistencies are in
`docs/STANDARDS.md`.

## When the code does something two ways

**The newest module wins.** `module-queuing-window` is the reference, then
`module-chat`. `module-auth` and `module-permissions` are older and carry
patterns marked **Legacy — do not copy** in these files. Write new code the new
way. Do not rewrite legacy code as a side effect of an unrelated change. Do it
only when asked, or when the task is that code.

If these rules and the code disagree, the code in the reference module is right
and the rule is stale. Say so, and fix the rule in the same change.

## The principles that recur (DESIGN-NOTES Part 7, PLAN §9)

1. **A feature is a `module-*` package**, vertically: schema fragment, domain,
   Nest module, resolvers, React pages. Apps compose modules and implement ports.
   An app file should be wiring, not logic.
2. **Fail closed, and say why.** Missing context denies, an empty gate renders
   its fallback, an unbound port means "off", and an unset cap is a floor, never
   unlimited. A refusal names its reason (`not_granted` vs `not_entitled`).
3. **Nothing overrides anything.** Grants add up, and entitlements filter them.
   There is no deny rule and no precedence.
4. **The code registry is the source of truth and the database mirrors it.**
   Features, limits and defaults are declared in code and synced. A row nobody
   declared is ignored. Seeders upsert and deprecate, never delete.
5. **Implement each convention once**, in the dependency-free core (`src/index.ts`
   / `src/domain/`), and import it everywhere. Two copies of a rule become an
   incident.
6. **Make the wrong state unrepresentable** (types, `@@unique`, a registry
   check) rather than forbidden in a comment.
7. **Keep separate questions separate:** grants vs entitlements, features (may I)
   vs limits (how many), authentication vs authorisation, "no" vs "I don't know".
8. **Name the cost.** A known gap goes in PLAN §12 as an open decision, not in a
   `TODO`.
9. **Extract to a shared package only when a second consumer exists.** Do not
   extract on speculation.
10. **Modules never import each other.** Shared shapes are copied structurally,
    and cross-module questions are ports the app answers. `userId` is a bare
    string with no foreign key.

## Security that applies everywhere

- Credential paths reveal nothing: one message, one status, the same work. Watch
  timing too: never skip or await work only on the branch for known accounts.
- Tokens never reach client JavaScript. The browser talks to `/api/auth/*` route
  handlers, which hold httpOnly cookies.
- A public surface carries a non-empty reason, and a guessable secret also carries
  the credential marker (it gets the tight throttle).
- Never default a secret. A missing secret fails the boot.
- Env values live in gitignored profiles (`envs/<name>/`); `.env.example` files
  are public templates with secrets left empty. Development defaults to the
  `local` profile. Before running anything that writes to a database, check the
  active profile (`pnpm env:show`); never switch to staging or production unless
  asked.
- `apps/web-server/seed-data/snapshot.json` is public: no real customer data or
  credentials in the dev database.

## Done means

- `pnpm typecheck`, `pnpm test` and `pnpm lint` pass. If the change is visible,
  run the app, because boot-time failures pass `tsc`.
- Docs are updated in the same change: the module README for a contract change.
  For a real decision, add a dated entry at the TOP of PLAN §13:
  `- **YYYY-MM-DD** — **One-line decision.**`, then the cause, bold-led bullets,
  what was NOT done and why. A known gap goes in §12.
- Conventional commit, scoped by package directory: `feat(module-queuing-window): …`.
