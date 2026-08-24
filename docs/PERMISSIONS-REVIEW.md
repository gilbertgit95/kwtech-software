# Permissions logic — review

Findings against `@kwtech/module-permissions` as built on 2026-08-25. Severity is
about the permission layer's own guarantees, not about how any app might happen
to compensate for it.

**Status after the 2026-08-25 fix pass, and the test pass that followed:**

| | Finding | Status |
|---|---|---|
| C1 | Workspace access never enforced | **fixed** |
| C2 | Workspace/organization pairing unchecked | **fixed** |
| C3 | Role ownership across organizations | **read side fixed**, write side blocked on M4 |
| H1 | Limits advisory, audit helpers uncalled | **blocked** on M4 and a seed task |
| H2 | Deprecated features still grant | **fixed** |
| H3 | Archived workspaces still resolve | **fixed** |
| H4 | Free-form `level`/`status` | **fixed** |
| M1 | No staleness story | open — needs a decision with M5 |
| M2 | 403 for unauthenticated | **fixed** |
| M3 | `graphql_field` has no mechanism | blocked until the GraphQL layer exists (Phase 3) |
| M4 | No write path | open — the largest gap |
| M5 | Query cost | open — measure first |
| M6 | Impersonation undesigned | open |
| M7 | No audit trail | open |
| — | No tests | **done** — 202 tests, green |

---

## Critical — tenant isolation

These three share a shape: **the guard answers "may this user do X" without ever
asking "is X in a place this user may be".** Scope is parsed from the URL and
trusted as a location; nothing validates that the caller belongs there, or that
the ids in the path belong to each other.

### C1. Workspace access is never enforced — FIXED

`canAccessWorkspace()` exists, is exported, is used by the React layer — and is
**never called on the server**. `FeatureGuard` resolves a context and checks
features; it never checks whether the caller may enter the workspace the request
names.

So for `/api/v1/organizations/1/workspaces/999/data-samples`, a member of
organization 1 who is **not** a member of workspace 999 is allowed by every
organization-level feature they hold. Workspace membership currently restricts
nothing server-side; it only decides what the UI lists.

> **Fixed.** `FeatureGuard` now denies a workspace-scoped request unless
> `canAccessWorkspace(ctx, scope.workspaceId)`, ahead of the feature check and
> with reason `no_workspace_access`.
>
> One consequence had to be handled with it: platform support holds no membership
> anywhere, so the check would have locked out exactly the people it must not.
> `platform:support_access` now implies access-all alongside
> `workspaces:access_all`. Verified: an organization admin is refused in a
> workspace they do not belong to, while support staff are not.

### C2. A workspace is never checked to belong to its organization — FIXED

`parseScope` extracts both ids; nothing verifies the relationship.
`permWorkspaceMember.findFirst({ membershipId, workspaceId })` fails to match a
foreign workspace, so no workspace roles load — but **organization-level features
still apply**, and `ctx.workspaceId` is set to another tenant's workspace.

An administrator of organization A can therefore address organization B's
workspace and be authorised for it by A's roles. Whether data leaks depends on
each handler; the permission layer says yes.

> **Fixed.** `loadContext` resolves the workspace with
> `{ id, organizationId: membership.organizationId, archivedAt: null }` and
> returns null when it does not match — treated as not found, so the caller
> learns nothing about whether the workspace exists elsewhere. This closes H3 in
> the same lookup.

### C3. Role ownership across organizations is unverified — READ SIDE FIXED

`PermRole.organizationId` scopes a role to an organization, but no code checks
that a role granted to a membership belongs to that membership's organization.
`PermMembershipRole` and `PermWorkspaceMemberRole` reference `roleId` freely.

A bug or a compromised admin endpoint in one tenant can grant a role defined in
another. `assertRoleFeatureLevels()` guards level, not ownership.

> **Read side fixed.** `loadContext` discards any grant whose role has a non-null
> `organizationId` differing from the membership's, for both organization and
> workspace roles.
>
> **Write side still open.** There is no write path to validate on (M4), so a
> cross-tenant grant can still be *written* — it simply no longer takes effect.
> The defensive filter is not a substitute for rejecting the row.

---

## High

### H1. Limits are advisory — BLOCKED

`checkCapacity()` is a method nobody is obliged to call. Nothing in the module
prevents adding member N+1. Every cap — seats, workspaces, workspace members,
organizations per user — holds only where an app remembers to ask.

The audit helpers have the same problem: `auditRegistry()`,
`assertRegistered()`, `assertPlanLimits()` and `assertRoleFeatureLevels()` are
exported and **never called anywhere**. They are designed to run in a seed task
and in CI; neither exists yet, so they are currently dead code.

> **Blocked on M4.** Capacity belongs where the row is created, and there is no
> such place in the module yet. Until then these are **caller obligations, not
> guarantees** — recorded here and in the README rather than left to look like
> enforcement.

### H2. Deprecated features still grant — FIXED

`PermFeature.deprecatedAt` is written by the seed and read by nobody. A key
removed from the registry keeps granting access through existing role rows —
which is the opposite of what deprecating it was meant to achieve.

> **Fixed — decided: deprecation revokes.** Role-feature reads now filter on
> `feature: { deprecatedAt: null }`, so a deprecated key stops granting.
>
> Filtered in the query rather than in `composeContext`, deliberately: the
> module's own registry holds only *its* features, and filtering there would have
> dropped every other module's keys. `PermFeature` is the shared table, so the
> database is the only place that can answer this for all modules at once.

### H3. Archived workspaces still resolve — FIXED

`PermWorkspace.archivedAt` is consulted only when counting against the workspace
limit. A request scoped to an archived workspace resolves roles and grants
features normally.

> **Fixed** as part of C2's lookup — an archived workspace no longer resolves.
> It returns the same "not found" as a foreign workspace rather than a distinct
> reason; if the UI needs to say "this workspace is archived", that message
> belongs to the handler, not the permission layer.

### H4. `level` and `status` are free-form strings — FIXED

`PermRole.level`, `PermMembership.status` and `PermSubscription.status` are
`String`. `loadContext` casts `link.role.level as RoleGrant['level']` with no
validation, and queries hardcode `'active'`.

A row with `'Active'` or `'organization '` silently never matches: a role that
grants nothing, or a subscription that entitles nothing, with no error anywhere.
Silent denial is the safe direction, but it is undiagnosable.

> **Fixed.** Prisma enums `PermRoleLevel`, `PermMembershipStatus` and
> `PermSubscriptionStatus`, plus `toRoleLevel()` which validates on read and
> throws on an unrecognised value instead of casting. Verified:
> `toRoleLevel('Organization')` now raises rather than producing a role that
> silently grants nothing.

---

## Medium

### M1. No staleness or invalidation story

`effective` is computed per request and handed to the client via
`myPermissions`. When a role is revoked mid-session, the server picks it up on
the next request but the client keeps its list until something refetches. There
is no TTL, no subscription, no invalidation signal.

For a UI that only decides what to *show* this is cosmetic. It stops being
cosmetic the moment anyone caches the context beyond one request — which H1's
performance pressure (below) will encourage.

### M2. Missing context returns 403, not 401 — FIXED

`resolvePrincipal` returning undefined raised `ForbiddenException`. A frontend
reads 401 as "sign in" and 403 as "stop asking"; conflating them sends signed-out
users to a dead end.

> **Fixed.** The guard now distinguishes three outcomes: no principal → 401
> `UnauthorizedException`; a principal with no standing in this scope → 403 with
> reason `no_context`; otherwise the context. Neither wiring configured now
> throws a configuration error rather than silently allowing or denying.

### M3. `graphql_field` is vocabulary without a mechanism

The surface exists in the registry, and field-level checks are the stated reason
one query can serve users who may see different columns. There is no field guard,
no middleware, no documented pattern. A binding declared against it today would
name something nothing enforces.

### M4. The write side does not exist

**The largest gap in the module.** It answers permission questions and provides
nothing for changing permissions: no operation to invite a member, assign a role,
share a workspace, create a workspace, or start a subscription.

Consequences already visible above: capacity is unenforced (H1), role ownership
is unvalidated (C3), and every consuming app will reimplement the same writes —
which is exactly the duplication the module exists to prevent. The registry, the
level rules and the capacity checks all assume a write path that would enforce
them.

### M5. Query cost per guarded request

At workspace scope a single guarded call issues up to four queries: app roles,
membership with roles and workspace ids, the workspace member with roles, and
subscriptions. Memoised per request, so one GraphQL operation pays once — but
every request pays, including unauthenticated ones that end in a denial.

Worth measuring before optimising. The obvious lever — caching resolved contexts
across requests — is the one that turns M1 from cosmetic into real, so the two
decisions should be taken together.

### M6. Impersonation is a key with no design

`platform:impersonate` is registered and privileged. Nothing defines whose grants
apply while impersonating, whether the impersonator's app-level exemptions travel
with them, whether it is recorded, or whether one can impersonate into an
organization one could not otherwise reach. For a right described as "always
audited", there is no audit.

### M7. No audit trail

`grantedAt` and `addedAt` record when, never who, and revocation leaves no trace
— the row is deleted. The schema comments repeatedly justify decisions by "the
audit trail must stay readable", but no audit table exists.

---

## Missing information

- **How a user, organization or workspace comes into existence.** Onboarding is
  undefined, and it is where the `user:organizations` floor of 1 first applies.
- **Who writes `PermSubscription` rows**, with what idempotency, and what happens
  between a payment failing and `status` changing.
- **Identity.** Deliberately outside the module (§12.12), but nothing yet defines
  where it lives — which C3's fix and the write path both need.
- ~~**Tests.** Zero.~~ **Closed.** 202 tests (181 in `module-permissions`, 21 in
  `module-kit`), Jest 30 + `@swc/jest`, no database — the structural
  `PermissionsPrismaClient` is satisfied by a literal object. Every rule in
  PLAN §13 is a case, organised around the findings above: C1 and C2 have
  dedicated blocks, C3's read-side filter is tested for both grant tables, and
  the plan/limit regression below has its own test. Pure core and domain are at
  99–100% coverage; the untested remainder is Nest wiring that needs an
  integration harness.

  Two defects surfaced while writing them, neither previously known:

  - **The module had never been compiled.** `tsc` found seven errors, one a
    runtime break: the subscription query included `plan.features` but not
    `plan.limits`, while the mapping below it read `sub.plan.limits`. Every
    plan-sourced cap would have thrown on the first guarded request that
    reached a subscription. Fixed, with a regression test asserting the
    `include` shape as well as the result.
  - **`parseScope` misread interior empty path segments.** `filter(Boolean)`
    collapsed `/organizations//workspaces/ws1` to
    `['organizations','workspaces','ws1']`, reading the literal string
    `'workspaces'` as the organization id. It failed closed — no organization
    matches — but the guard and the router would then disagree about the
    request's LEVEL, which is the mismatch `@RequireScope` exists to catch
    rather than to produce. Interior empties are now preserved, so such a path
    resolves to app level with no ids.

---

## Suggested order

1. **C1, C2** — small, local to `FeatureGuard` and `loadContext`, and they close
   real tenant-isolation holes.
2. **H4** — enums; cheap now, and makes C3's read-side filter trustworthy.
3. **Tests** — before the write path, not after. Every rule above is a test case,
   and the pipeline already has worked examples to encode.
4. **M4, the write path** — which then subsumes C3 and H1 properly rather than
   defensively.
5. **H2, H3, M2** — deliberate decisions, each a few lines.
6. **M1 + M5 together**, once there is something to measure.
