# @kwtech/module-permissions

The permissions feature, whole — data model, domain logic, GraphQL surface,
server wiring and React components in one package. A consuming app declares the
dependency and wires two lines; it does not define feature types, write role
composition, query `perm_*` tables, or rebuild a permission gate.

This is the template for every `module-*` package. See
[docs/PLAN.md](../../docs/PLAN.md) §9 for the rules.

## What is inside

| Path | Import | Contents |
|---|---|---|
| `src/` | `@kwtech/module-permissions` | types, feature registry, decision functions, `composeContext` — **zero dependencies** |
| `src/server/` | `@kwtech/module-permissions/server` | `PermissionsModule`, `FeatureGuard`, `@RequireFeature`, `PermissionsService`, GraphQL object types + resolver |
| `src/react/` | `@kwtech/module-permissions/react` | `PermissionsProvider`, `useHasFeature`, `<FeatureGate>`, the admin pages |
| `src/react/realtime.ts` | `@kwtech/module-permissions/react/realtime` | `createRealtimeConnection` — the ONLY code importing `graphql-ws` |
| `src/graphql/` | `@kwtech/module-permissions/graphql` | client operation documents |
| `prisma/` | `@kwtech/module-permissions/prisma` | the module's schema fragment |

Framework packages are **optional peers**, so a server app never installs React
and a browser bundle never pulls Nest or Prisma.

⚠ An optional peer stops being optional the moment anything reachable from a
barrel imports it. `graphql-ws` was in exactly that position: `plans-page.tsx`
imported `PLAN_CHANGED` — a string — from the module that opens the socket, so
every consumer of `/react` resolved a WebSocket client whether or not they ever
subscribed. It only worked because this package carries `graphql-ws` as a
devDependency inside a pnpm workspace; a published consumer would have failed to
resolve it.

So the realtime CONTRACT (the option and connection shapes, the ticket path, the
subscription documents) lives in `react/realtime-contract.ts` and is exported
from `/react`, while `createRealtimeConnection` sits behind its own subpath. A
page can name a document and type a connection it was handed without installing
anything.

## Consuming it — server

```ts
PermissionsModule.forRoot({
  imports: [DbModule],
  prismaProvider: { provide: PERMISSIONS_PRISMA, useExisting: PrismaService },
  resolvePrincipal: (req) => {
    const r = req as { user?: { id: string }; orgId?: string; workspaceId?: string };
    return r.user ? { userId: r.user.id, organizationId: r.orgId, workspaceId: r.workspaceId } : undefined;
  },
})
```

Then guard a handler:

```ts
@RequireFeature(FEATURE.adminAccess)
@Post(':id/disable')
disable() { /* ... */ }
```

Register `PermissionsResolver` in the app's GraphQL module and its queries join
the composed schema — code-first, no SDL, no stitching.

## Consuming it — web

```tsx
<PermissionsProvider value={grants}>…</PermissionsProvider>

<FeatureGate allOf={[FEATURE.adminAccess]}>
  <DisableUserButton />
</FeatureGate>
```

Mounting `PermissionsProvider` also publishes the held keys through
`@kwtech/module-kit/react`, so any OTHER module can gate its own controls with
`useHoldsFeature` without importing this package. One source of the list, and no
cross-module import.

Everything the `/react` entry point exports:

| export | what it is |
|---|---|
| `PermissionsProvider`, `usePermissions` | the resolved context |
| `FeatureGate` | show or hide by key, with a reason |
| `FeatureDenied`, `denialMessage` | the refusal, worded once |
| `useHasFeature`, `useHasAllFeatures`, `useHasAnyFeature`, `useFeatureDecision`, `useCanAccessWorkspace` | the same checks the server guard runs |
| `AdminPage`, `AdminPlaceholder` | the frame the admin screens share |
| `FeaturesPage`, `FeatureNewPage`, `FeatureImportPage`, `FeatureEditPage` | the registry screens — the grantable vocabulary |
| `RolesPage`, `RoleNewPage`, `RoleEditPage`, `RoleForm` | the role screens — what a PERSON may do |
| `PlansPage`, `PlanNewPage`, `PlanEditPage`, `PlanForm` | the plan screens — what an ORGANIZATION bought |
| `SubscriptionsPage`, `SubscriptionNewPage`, `SubscriptionEditPage`, `SubscriptionForm` | who is on which plan |
| `OrganizationsPage` | placeholder |
| `permissionsWebModule` | the descriptor an app lists |

The plan screens are the deliberate mirror of the role screens, because a plan
and a role are the same shape of thing pointed at different questions: a named
collection of features, with no inheritance and no precedence. They are never
merged — a role says the PERSON may, a plan says the ORGANIZATION bought it, and
a feature needs both. That is what lets a denial say "ask an administrator" or
"upgrade your plan" instead of one flat refusal.

Two places the mirror deliberately breaks, both documented at the code:

- **A plan may only sell organization- and workspace-level features.** App-level
  grants are unioned in AFTER the entitlement filter, so an app-level key inside
  a plan is never consulted — it would read as a sold feature and entitle
  nobody. `assertPlanFeatureLevels` refuses it rather than filtering it out.
- **No no-escalation rule on plans.** A role grants, so putting a right into one
  you do not hold is escalation; a plan entitles, and whoever uses the feature
  still needs a role that grants it. The plan editor therefore offers the whole
  catalogue.

The hooks and the guard import the SAME `check.ts`, so a `<FeatureGate>` and a
`@RequireFeature` cannot disagree about the rules — not because they are kept in
step, but because there is nothing to keep in step.

## Three levels of user access

Every level is a **role held by a user**. Nothing else grants anything:

| Level | What it is | Stored as |
|---|---|---|
| **app** | the user's role on the application itself — global, across everything | `PermUserRole` (user → role) |
| **organization** | the user's role in one organization they are a member of | `PermMembershipRole` on their membership, `workspaceId` null |
| **workspace** | the user's role in one workspace, for finer-grained access | `PermMembershipRole` on their membership, `workspaceId` set |

A workspace sits under an organization and exists to make access more granular:
an organization role applies across every workspace in it, a workspace role only
inside its own. Neither overrides the other — both simply apply, which is why
there is no precedence rule anywhere in this module.

### Membership

An organization has indefinitely many members, each with organization-level
roles. It has indefinitely many workspaces, and each workspace has its own
members, each with workspace-level roles:

```
PermMembership (user ↔ organization)
  └── PermMembershipRole            organization-level roles
  └── PermWorkspaceMember (↔ workspace)
        └── PermWorkspaceMemberRole workspace-level roles
```

Workspace roles hang off **workspace membership**, not off the organization
membership with a nullable workspace column. Three things follow:

- Holding a role in a workspace you cannot enter becomes impossible to express,
  rather than merely wrong. That contradiction was previously reachable.
- Both grant tables get honest composite primary keys. The old shape needed a
  surrogate key — Postgres forbids a nullable column in a primary key — and its
  unique index could not stop duplicate organization-wide grants, because
  Postgres treats NULLs as distinct.
- Workspace roles are loaded only for the workspace in hand. A user in fifty
  workspaces does not pay for forty-nine of them on every request.

Workspace membership hangs off the organization membership rather than the user,
so belonging to a workspace of an organization you are not in cannot be
represented.

### How many — limits

Caps come from **two sources**, and the registry says which is which:

| Limit | Source | Counted over |
|---|---|---|
| `user:organizations` | the user's **app-level role** | user |
| `organization:members` | the organization's **plan** | organization |
| `organization:workspaces` | plan | organization |
| `workspace:members` | plan | workspace |

`user:organizations` cannot come from a subscription: the question is asked
*before* any organization exists, so there is no plan to ask. The user's standing
on the application decides it, stored as `PermRoleLimit` rows on an app-level
role — the same key/value shape as `PermPlanLimit`, so both resolve through one
registry into one map.

That is also why `ctx.limits` is always present, even at app level where no
subscription is consulted at all. A *value* of `null` means that key is
unrestricted; the map itself is never null.

Member counts are capped by the subscription — **organization members,
workspaces, and workspace members alike**. None of the three is ever unlimited by
accident. `PermPlanLimit` holds the values as key/value rows so adding a new
limit is a row rather than a migration, and `LIMIT_REGISTRY` in
`domain/limits.ts` is the source that says which keys exist and what happens when
a plan omits one.

Every plan-sourced limit is `required` and falls back to **1**, never to
unlimited. Role-sourced limits are not required — most roles say nothing about
how many organizations a person may have, and the floor of **1** is the right
answer for them: one organization each unless a role says otherwise. One rather than zero: an organization is created before it is
subscribed, and a cap of zero stops its founder from being its own first member —
sign-up would fail before billing was ever reached. One admits exactly the owner,
which is the smallest coherent organization.

`assertPlanLimits()` refuses at seed time a plan that omits a required limit, so
no configured plan ever falls back to that floor. It exists for the unconfigured
and the lapsed.

Limits are kept **separate from features throughout**, because they answer
different questions at different moments: a feature is checked when someone reads
or acts, a limit when someone writes one more row. Merging them makes a full
organization indistinguishable from an unauthorised one — the user is told
"access denied" when the truth is "buy more seats", and the ticket goes to the
wrong team. `PermissionsService.checkCapacity()` returns `limit`, `current` and
`remaining` so the message can say what to do about it.

Resolution mirrors entitlement exactly:

| Plans | Limits |
|---|---|
| no subscription model | `null` — nothing capped |
| no subscription model | plan-sourced keys unrestricted; role-sourced keys still resolve |
| no active plan | every plan-sourced key at its floor of `1` — a lapsed organization stops growing but stays usable; existing members are never removed, only new ones refused, since the check is `current < limit` |
| active plans | the **max** any active plan gives each key, falling back to the floor of `1` for keys no plan sets |

Role-sourced keys resolve the same way from the caller's app-level roles: the
**max** any of them gives, else the floor of `1`. Max in both cases is the
additive reading grants already get — holding two roles, or an organization plan
plus a workspace plan, adds capacity rather than one capping the other.

`remaining` is `null` when unrestricted, never `Infinity`: this crosses a JSON
boundary, and `JSON.stringify(Infinity)` is `null`, which a client cannot tell
apart from "unknown".

## How access is resolved

A request carries its level in the path, and **the level decides which grant
levels participate at all**:

| Trigger | Participates | Subscription filter |
|---|---|---|
| `/api/v1/*` — app | app-level roles only | not consulted |
| `/api/v1/organizations/:org/*` | organization roles, then ∪ app-level | applied to the organization features |
| `/…/workspaces/:ws/*` | organization + that workspace's roles, then ∪ app-level | applied to the combined set |

```
  1. combine    the role features at or below the triggered level
                (app level: none — app roles are not in this step)
                          │
  2. filter     ∩ organization subscription — anything not in the plan drops
                          │
  3. union      + app-level role features — NOT filtered
                          │
                          ▼
              effective: every feature accessible at this scope
```

An organization role is not "also true" at app level — it is *unasked*, because
the request named no organization for it to be true about. At app level step 1 is
empty by construction, so the same three lines yield "app features only" with no
special case to keep in step. The service skips the membership and subscription
queries entirely there; querying a membership with no organization in hand would
pick an arbitrary one and answer a question nobody asked.

Worked example — an org admin who is also platform support, in workspace `ws_2`,
organization on a `pro` plan (`admin:access`, `workspaces:share`):

| Request | effective |
|---|---|
| `/api/v1/me` | `platform:support_access` |
| `/api/v1/organizations/1/members` | `admin:access`, `platform:support_access` — `billing:manage` dropped by the plan |
| `/api/v1/organizations/1/workspaces/2/data-samples` | `admin:access`, `platform:support_access`, `workspaces:share` |

**The order is the design.** Filtering before the app-level union is what makes
step 3 an exemption rather than just another grant — running it after would strip
staff rights along with everyone else's, and a lapsed organization is exactly
when support is needed.

`composeContext()` runs this once per request into `ctx.effective`; every check
is then a set lookup, not a re-derivation, which matters when one GraphQL
operation asks fifty times. The three inputs are kept alongside the result so a
denial can name **which step** dropped the feature — `checkFeature()` returns
`not_granted` before `not_entitled`, following pipeline order, and
`explainFeature()` returns the full trace for an admin diagnostic.

⚠️ An app whose URLs do not carry the organization id must supply it through
`resolvePrincipal`, or its organization-level roles will never participate.

## Roles

**A role is nothing but a named collection of features given to a user.** No
inheritance, no implied rights, no precedence — everything a role means is the
list it carries, which is what makes "what can this person do" answerable by
reading rows instead of simulating a hierarchy.

Roles exist at three levels, and so does every feature:

| Level | Applies | Granted through |
|---|---|---|
| `app` | across every organization — platform staff: support, billing ops, incident response | `PermUserRole` — to a **user**, with no organization involved |
| `organization` | everywhere inside one organization | `PermMembershipRole`, `workspaceId` null |
| `workspace` | inside one workspace | `PermMembershipRole`, `workspaceId` set |

App-level roles need their own grant table because a membership is *(user,
organization)* and an app-level role has neither an organization nor a workspace
to hang from. Forcing it through a membership would mean inventing a fake
organization for staff, which then shows up in every organization list anyone
queries. It also means **a user with only app-level roles has no membership at
all** — `loadContext` still returns a usable context for them, because returning
null there would lock support out of every organization.

**An organization- or workspace-level role may only collect features at its own
level**, enforced by `assertRoleFeatureLevels()`. Without it a workspace-level
role can quietly contain `billing:manage`, and anyone able to create workspace
roles — a routine, widely delegated right — could grant themselves an
organization-wide one. That is privilege escalation, not a typo, so it throws
rather than filtering silently.

**App-level roles are exempt and may collect any level's features.** The
escalation above needs a lesser right to escalate FROM, and an app-level role
has none: it hangs off no membership, and no tenant administrator can mint one.
The exemption is what makes an all-access `super-admin` expressible — only two
registry keys are app-level, so a strictly-levelled app role could not read an
organization's roles or fix its billing. An unregistered key is still refused at
every level, app included.

`featuresForLevel()` is what the role editor offers for a given level, and
mirrors the same rule: everything for `app`, only its own keys for the two
scoped levels. `allFeatureKeys()` is what `super-admin` is seeded from.

**Level is a filter, not a precedence chain.** App, organization and workspace
grants all simply apply; nothing overrides anything, so there is no "which wins"
rule to get wrong — the same reason there is no deny rule.

**App-level grants bypass plan entitlement.** A lapsed organization is exactly
when support is needed, so gating staff behind the customer's subscription locks
out the people trying to fix it. `PermissionContext.grantedAtAppLevel` carries
that subset, and `checkFeature()` exempts it. This is a deliberate security
trade: app-level roles are the one path that ignores billing state, so treat
`platform:*` grants as the audited, tightly held things they are.

## What the guard checks, in order

1. **Authentication** — no principal is a 401, not a 403. "Who are you" failing
   is a different answer from "you may not".
2. **Scope integrity** — the workspace in the path must belong to the
   organization in the path, and must not be archived. A mismatch is treated as
   *not found*, so the caller learns nothing about workspaces in other tenants.
3. **Workspace access** — `canAccessWorkspace`, before any feature question.
   Reason `no_workspace_access`, distinct from a missing grant: "you are not in
   this workspace" and "you lack this right here" need different answers.
   `workspaces:access_all` and `platform:support_access` both bypass it — support
   staff hold no membership anywhere, and entering an organization they do not
   belong to is the entire point of the right.
4. **Declared scope** — if the handler used `@RequireScope`, its level must match
   the parsed one, or the handler is mounted a level from where it thinks it is.
5. **Features** — `@RequireFeature` against `ctx.effective`.

Grants are additionally filtered on the way in: a role whose `organizationId`
differs from the membership's is discarded, and a feature the seed has deprecated
stops granting.

## Changing permissions — `PermissionsWriteService`

Answering permission questions and changing them are different services, wired
separately. The write client is bound on its own key, so an app that only reads
does not acquire a write path by having wired reads:

```ts
PermissionsModule.forRoot({
  prismaProvider:      { provide: PERMISSIONS_PRISMA,       useExisting: PrismaService },
  prismaWriteProvider: { provide: PERMISSIONS_PRISMA_WRITE, useExisting: PrismaService },
  resolvePrincipal: (req) => …,
})
```

| Call | Needs | Capped by |
|---|---|---|
| `createOrganization` | — (no organization exists yet to grant a right) | `user:organizations`, from the actor's app-level role |
| `addMember` / `removeMember` | `members:manage` | `organization:members` |
| `assignRole` / `revokeRole` | `members:manage` | — |
| `createWorkspace` / `archiveWorkspace` | `workspaces:manage` | `organization:workspaces` |
| `shareWorkspace` / `unshareWorkspace` | `workspaces:share` | `workspace:members` |
| `assignWorkspaceRole` / `revokeWorkspaceRole` | `workspaces:share` | — |

Four properties worth relying on:

1. **Every call checks the actor**, duplicating what `FeatureGuard` already did
   at the HTTP edge. A worker, a CLI command and a seed script arrive with no
   guard, and "the caller checked" is not something this code can verify.
2. **Capacity is counted where the row is created**, inside the transaction that
   creates it — so a cap is a guarantee of this service rather than an
   obligation on every app. See the caveat below.
3. **The role is read inside the transaction and judged there**, never trusted
   from the caller. A `roleId` from another tenant is refused, not merely
   ignored on the way out.
4. **Grants are idempotent, membership is not.** Re-granting a held role returns
   `{ granted: false }`; re-adding an existing member is `already_exists`,
   because "add this person" carries an intent already satisfied differently.

Refusals are `PermissionWriteError` with a `reason` — `not_permitted`,
`at_capacity`, `role_foreign_to_organization`, `role_level_mismatch`,
`role_features_invalid`, `not_found`, `already_exists` — not Nest exceptions, so
the service is callable from a CLI or a test that never loads Nest. The
distinctions carry advice: `at_capacity` means buy more, `not_permitted` means
ask an administrator, and `role_foreign_to_organization` means neither will help.

⚠️ **The capacity caveat, stated precisely.** The count and the insert share one
transaction, but under READ COMMITTED — Prisma's and Postgres's default — two
concurrent invites can both count N and both insert, giving N+2 against a cap of
N+1. The transaction narrows the window to a round trip; it does not close it.
Closing it needs the host, because this module deliberately emits no SQL: run the
app's client at `Serializable`, or take an advisory lock on the organization in
the app's own wrapper.

### Still not here

- **Subscriptions.** Written by the billing integration, not by a user action.
  Who writes them, with what idempotency, and what happens between a payment
  failing and `status` changing are open questions; guessing would put a wrong
  answer in the one table a permission check must not have to doubt.
- **Users.** The module does not own identity — it grants against a `userId` it
  never issues.
- **An audit trail.** `grantedAt` records when, never who. Every method takes the
  actor, so adding it is a new table and a call rather than a change to every
  signature. See [docs/PERMISSIONS-REVIEW.md](../../docs/PERMISSIONS-REVIEW.md) M7.

⚠️ **Still caller obligations.** `auditRegistry()`, `assertRegistered()` and
`assertPlanLimits()` are exported for CI that does not exist yet, so nothing
calls them. `assertRoleFeatureLevels()` is called by `assertRoleDefinable()` on
the write path.

## Syncing the registry into the database

`perm_role_feature` carries a foreign key to `perm_feature`, so **until the
registry has been written to the database, no role can be granted anything at
all.** That makes it reference-data migration rather than seeding: it belongs on
every deploy, not in a one-off script somebody remembers.

`@kwtech/module-permissions/server` ships the mechanics, because they must agree
with this module's own read path — which filters `deprecatedAt: null` — and
because they are identical for every app that adopts it:

```ts
import { FEATURE_REGISTRY } from '@kwtech/module-permissions';
import { grantAppRole, syncFeatureRegistry, upsertSystemRole } from '@kwtech/module-permissions/server';

await syncFeatureRegistry(prisma, FEATURE_REGISTRY);          // upsert + deprecate, never delete
await upsertSystemRole(prisma, SUPER_ADMIN, FEATURE_REGISTRY);   // your role definitions
await grantAppRole(prisma, { userId, roleKey: 'super-admin' });
```

`prisma` here is anything satisfying `PermissionsRegistryClient` — a third
structural interface alongside the read and write clients, kept separate because
it is used once by a script at deploy time rather than injected into a running
service. This package still opens no connection.

**What stays yours:** which roles exist and what they are called, and resolving a
person to a `userId` — that reads `auth_user`, which belongs to
`@kwtech/module-auth`, and these two modules never import each other. See
`apps/web-server/src/seed/README.md` for how one app composes it.

## The admin screens this module ships

A consuming app does not build these. It lists the module and the routes appear.

| route | key | what it is |
|---|---|---|
| `/admin/features` | `features:read` | the registry, in a searchable grid |
| `/admin/features/new/manual` | `features:create` | define one by hand |
| `/admin/features/new/import` | `features:import` | many, from a spreadsheet |
| `/admin/features/:featureId/edit` | `features:update` | change one |
| `/admin/roles` | `roles:read` | every role and what it grants |
| `/admin/roles/new` | `roles:create` | define one |
| `/admin/roles/:roleId/edit` | `roles:update` | change what one grants |
| `/admin/organizations` | `organizations:read` | the tenants on the platform |
| `/admin/organizations/:organizationId` | `members:manage` | one tenant's people, invitations and workspaces |
| `/admin/plans` | `plans:read` | the catalogue |
| `/admin/subscriptions` | `subscriptions:read` | who is on what |
| `/admin/invitations/new` | `roles:grant_app` | invite somebody to the PLATFORM |

The five `features:*` keys are split by RISK, not by convenience:

- **`features:read`** is organization level — someone building roles has to see
  what a role can contain.
- **`features:create` / `import` / `update` / `delete`** are **app** level, so
  `assertRoleFeatureLevels` refuses them inside an organization-level role.
  That is the escalation being guarded against: anyone able to invent a feature
  could invent one that grants anything.
- **`create`, `import` and `update` are three keys, not one.** Create adds a key
  nobody holds; import does the same at very different scale; update changes what
  an EXISTING key means under everyone already holding it. Keeping update with
  create would make the safe right imply the risky one.

## Invitations — two offers, one row

`PermInvitation` covers both, which is why `organizationId` is nullable and
`appRoleId` sits beside it. A second table would have duplicated the token, the
expiry, the revocation, the email and the accept page for a row differing in one
column.

| offer | written from | key | grants on acceptance |
|---|---|---|---|
| **organization** | the tenant's own page | `members:manage` | a membership, and the organization role if one was named |
| **platform** | `/admin/invitations/new` | `roles:grant_app` | an app-level role, and no membership |

`inviteUser` checks the guards per FIELD rather than per method — `members:manage`
when an organization is named, `roles:grant_app` when an app role is — so a
tenant administrator never needs platform rights to invite a colleague. The
platform mutation deliberately accepts no organization: adding somebody to a
tenant is that tenant's screen, next to its member list.

**The role rides on the invitation.** The invited person may not exist yet, so
the role cannot be granted to them — it is chosen when the row is written and
applied when `acceptInvitation` finally has a userId. Exactly what `roleId`
already did for the organization role, one level up.

**Acceptance replaces an ORGANIZATION role and never an app-level one.** An
invitation naming an organization role replaces the member's — that is what the
inviter asked for, on a screen showing the member list. An invitation naming an
app-level role only GRANTS it to somebody holding none: the inviter there is
looking at an address rather than an account, and the form defaults to the
least-privileged role, so replacing would have demoted an existing super admin
the moment they followed the link. Changing an existing person's app role is
`assignAppRole`, from the Users page.

Both invite screens also refuse an address that already exists:

- the members form refuses an address already in that organization, or already
  holding a live invitation to it
- the platform form refuses an address that already has an account, and says to
  edit their role from the Users page instead

⚠ Both checks are **advisory**. Resolving an address to a user means reading
`auth_user`, which this module may not (PLAN §12.12), so the write path cannot
enforce either — they stop the mistake at the screen where it is made. The
consequence that mattered, an app-level demotion, is closed in the write path
itself rather than left to them.

**`defaultAppRoleKey` fills the hole.** The model is additive, so there is no
default-on: an account with no app-level role holds nothing at all and cannot
even edit its own profile. Set the option and `acceptInvitation` grants that
role when the invitation named none.

Both grants — the invitation's and the baseline's — run only for somebody
holding NO app-level role. The module cannot ask whether an account is new (it
may not read `auth_user`), but a brand-new one holds nothing by construction, so
"holds none" is the same set and is enforced with data the module owns.

### The write screens produce registry source, not rows

`syncFeatureRegistry` deprecates every `perm_feature` row absent from the
registry, and `assertRegistered` refuses an unregistered key — so a feature
written straight to the table would be switched off by the next deploy and could
never be granted meanwhile. It would look saved and be inert.

So the screens validate and compose, and emit the entry to paste into
`feature-keys.ts`. See `docs/PLAN.md` §12.22 for the open question of reversing
that.

### Denials

`FeatureDenied` renders the refusal, and `denialMessage(reason)` is the sentence
alone for a caller owning its own layout:

```tsx
import { FeatureDenied, denialMessage } from '@kwtech/module-permissions/react';
```

One wording in one place. "Upgrade your plan" and "ask an administrator" are
different errands, and sending someone on the wrong one wastes a support ticket.

## Tags, filtering and paging

### Tags

A feature already has three groupings — module, level, and the namespace in its
key — and every one is a HIERARCHY: a key belongs to exactly one. Tags exist for
the groupings that are not. `admin` spans `features:*`, `roles:*`, `members:*`
and `billing:*`, which no single tree can say without duplicating something.

```ts
import { FEATURE_TAG, normaliseTags, tagsInUse } from '@kwtech/module-permissions';
```

The vocabulary is CLOSED — `FEATURE_TAG` declares them and validation refuses
anything else. Free text acquires `admin`, `Admin` and `administration` within a
month, and the filter meant to collapse a list into a few piles then produces
three piles meaning one thing.

⚠️ **Tags never grant.** Nothing in `checkFeature`, the guard, or any decision
reads them. "Everyone with the admin tag" would be the wildcard grant this model
already rejected — a role row must describe what its holder can do, and a tag is
a label somebody can edit. Asserted in the tests, not merely intended.

### Filtering

`filterFeatures` is a pure function used by the API **and** the page, so the
endpoint and the screen cannot answer different questions:

```ts
filterFeatures(FEATURE_REGISTRY, { search, modules, levels, tags, isPrivileged, unboundOnly });
```

Two rules within a facet, and one of them is arithmetic rather than preference:

- **`modules`, `levels` — ANY of.** A feature has exactly one of each, so
  requiring all would always match nothing.
- **`tags` — ALL of.** A feature has many, so intersecting is meaningful and
  each one narrows.

Facets always AND with each other. `unboundOnly` answers the most useful audit
question the registry has: which keys read as coverage in a role editor while
guarding nothing?

### Paging

```ts
paginate(rows, { limit, offset }); // -> { items, total, limit, offset, hasMore }
```

`MAX_PAGE_SIZE` **equals** `DEFAULT_PAGE_SIZE` (100), so `limit` can only ever
narrow. A default protects the caller who does not ask; a CAP protects the server
from the one who asks for everything — `?limit=100000` against a default-only
endpoint is the same unbounded query with extra steps. Out-of-range values are
clamped, not refused, and the response echoes the limit actually applied.

Both `Query.permissionFeatures` and `GET /permissions/features` filter **then**
page. The other order counts rows the caller never asked about and leaves page
two missing rows page one filtered out.

## Enforcement is opt-in

**Only registered features are checked. Everything else is untouched.**

### Bindings enforce themselves

A handler declaring no `@RequireFeature` is checked against the registry's own
BINDINGS before being let through. `features:read` declaring
`graphql_operation: 'Query.permissionFeatures'` guards that query by the
declaration existing.

That closes a real gap: the binding once named the query while the query had no
guard at all, so the UI hid the page and the API served the data anyway. A claim
and its enforcement in two places is the arrangement that produced it; now there
is nothing to drift.

`@RequireFeature` still wins where present — it is more specific, and it is what
a reader sees on the handler. `enforceBindings: false` turns the fallback off for
an app that guards its surfaces another way.

`/auth/signin` is a route, not a feature — no key, no gate, no check, and no
context is even loaded for it. The same holds at every surface: a controller
handler with no `@RequireFeature` passes straight through, a resolver without one
is never inspected, a component not wrapped in `<FeatureGate>` renders, and a
route descriptor with no `feature` is neither filtered from the navigation nor
stopped by middleware.

This is deliberate. Most surfaces in an application are not access-controlled —
sign-in, sign-out, health checks, public listings, the marketing pages — and a
registry forced to name every one of them would be mostly noise, which is exactly
how the entries that matter stop being read.

Two consequences worth holding onto:

**An empty gate is not the same as no gate.** Not wrapping a control is how it
stays public. Wrapping one in a `<FeatureGate>` that declares no keys is a
mistake, and renders the fallback instead of the children — an empty gate that
rendered would look guarded in review while guarding nothing.

**The cost, stated plainly:** an endpoint that *should* be guarded and is not
looks exactly like one that is deliberately public. Nothing in the module can
tell them apart, and `auditRegistry()` will never mention it — it audits the
registry, not the absence of one. Closing that gap means surfaces declaring
themselves public rather than being public by omission (a `@Public('reason')`
marker plus a coverage report). Not built; logged as an open decision in
[docs/PLAN.md](../../docs/PLAN.md) §12.15, because it is a real change in how
much annotation every surface carries.

## Scope — how the level is decided

The level of a request is read from its path, never guessed and never carried in
a header someone can forget to send. One convention, mirrored on both sides:

```
server  /api/v1/*                                            app
        /api/v1/organizations/:orgId/*                        organization
        /api/v1/organizations/:orgId/workspaces/:wsId/*       workspace

web     /*                                                    app
        /organizations/[org_id]/*                             organization
        /organizations/[org_id]/workspaces/[workspace_id]/*   workspace
```

`parseScope()` lives in the dependency-free core, so the Nest guard, the Next
middleware, the navigation builder and the tests all agree on it — two
implementations of this convention is one implementation plus a future incident.
`scopePath()` is the inverse, so links are built by the same rule they are parsed
by. An unrecognised path is app level with no ids: the most restrictive reading,
and never an exception, because a parser that threw would turn a typo'd URL into
a 500 instead of a 403.

**REST needs no annotation** — the ids are already in the URL, and the guard
parses them. **A GraphQL resolver has no path**, so it declares its level and
names the arguments carrying the ids:

```ts
@RequireScope('workspace')
@RequireFeature(FEATURE.workspacesShare)
@Mutation(() => Workspace)
shareWorkspace(@Args('organizationId') orgId: string, @Args('workspaceId') wsId: string) {}
```

Wire `getArgs: (ctx) => GqlExecutionContext.create(ctx).getArgs()` once, and the
guard reads them — keeping the `@nestjs/graphql` import in the app that already
depends on it.

`@RequireScope` is worth adding to REST handlers too. The guard then checks the
declared level against the parsed one and refuses on a mismatch, which catches a
controller mounted a level away from where it thinks it is. That is otherwise a
**silent under-check**: the wrong scope still resolves a perfectly valid-looking
context, just for the wrong organization.

The per-request context cache is keyed on the scope for the same reason — a cache
keyed on the request alone would serve a workspace-scoped answer to an
organization-scoped field in the same GraphQL operation.

## What a feature is

**A feature is the smallest thing a user can be given access to.** A *binding*
names the concrete place it is enforced. Eight surfaces:

| Surface | Identifier | Enforced by |
|---|---|---|
| `rest_endpoint` | `POST /workspaces/:id/share` | `@RequireFeature` on the handler |
| `graphql_operation` | `Mutation.shareWorkspace` | `@RequireFeature` on the resolver |
| `graphql_subscription` | `Subscription.workspaceUpdated` | the WS handshake — a different moment, so a key guarding an operation does not automatically guard a subscription |
| `graphql_field` | `Organization.billingEmail` | a field guard — what lets one query serve users who may see different columns, instead of forking the operation |
| `job` | `reindex-search` | the worker, before the job runs |
| `cli_command` | `kwtech roles:grant` | the CLI, before the command runs |
| `ui_route` | `/admin/roles` | middleware + the nav filter — **derived from route descriptors, not hand-written** |
| `ui_component` | `RoleEditor` | `<FeatureGate>` |

Add more surfaces when a genuinely different enforcement *moment* appears — that
is the test. `ui_action` is not on the list because the button and the action it
triggers are gated at the same point, and a surface that never enforces anything
separately is a second name for the same thing.

**Bindings are only listed once the guard exists.** A binding naming an endpoint
nobody wrote reads as coverage in the role editor while guarding nothing.
`auditRegistry()` reports the keys still waiting for one, and the surfaces two
keys both claim. `assertRegistered()` runs the other direction: a key used in
code but missing from the registry can never be granted, so every check behind
it silently fails. Run both from the seed task and from a test, so drift breaks
CI rather than surfacing as "why can nobody use this button".

**What is deliberately not a feature:** record-level access ("may I edit *this*
document"). That is a data policy — it depends on ownership, sharing and state,
not on a key someone can be granted — and squeezing it into the registry
produces a key per record. Model it separately when it is needed.

*Planned:* deriving `rest_endpoint` and `graphql_operation` bindings from Nest's
`DiscoveryService` the way `ui_route` bindings are derived from route
descriptors, so the registry verifies itself against the guards that actually
exist instead of against what someone remembered to write down.

## The data model

```
user ──membership──▶ organization ──subscription──▶ plan ──▶ entitlements
             │              │                                     │
             │              └──▶ workspace ◀── workspace member    │
             │                       ▲                            │
             └──▶ role grants ───────┘ (scoped, or org-wide) ──────┴──▶ allowed
```

Both levels are shared, and sharing is explicit at both: a person joins an
organization through `PermMembership` and a workspace through
`PermWorkspaceMember`. Being in the organization does **not** imply seeing every
workspace — that is a right (`workspaces:access_all`) granted by a role, not a
structural shortcut, so an organization can compose it into whichever role it wants.

**A feature is allowed when the caller's ROLES grant it AND the organization's
PLAN includes it.** Those two are tracked separately all the way through, and
never collapsed into one boolean, because they fail for different reasons and
need different advice — "ask your administrator" versus "upgrade your plan".
Conflating them makes billing bugs present as permission bugs, which is how they
end up debugged by the wrong team. `checkFeature()` returns the reason;
`FeatureGate`'s `renderDenied` and the guard's `ForbiddenException` both carry it.

**Scope is a filter, not a precedence chain.** A role grant is organization-wide
(`workspaceId` null) or belongs to one workspace. Both simply apply; nothing
overrides anything, so there is no "which wins" rule to get wrong. An absent
active workspace asks the organization-wide question — it is never a wildcard,
because treating null as "all" is how a scoped grant silently becomes a global one.

**A plan is a collection of features too** — the same shape as a role, answering
a different question: a role says the *person* may, a plan says the organization
or workspace *bought it*. Subscriptions attach at both levels
(`PermSubscription.workspaceId` null = organization-wide, set = that workspace)
and are **additive**, exactly like role grants. A workspace plan adds to what the
organization bought rather than replacing it; making it an override would
introduce a precedence rule, and the failure that follows is a downgraded
workspace silently revoking an organization-wide entitlement.

**Three subscription states, not two.** No plan model at all (`entitled: null`),
no active plan (`entitled: []`), and active plans (their union). Collapsing the
middle into the first silently grants everything to an organization that stopped
paying.

Expanding any of users, organizations, workspaces, roles, features or
subscriptions means editing `prisma/permissions.prisma`, the registry in
`src/feature-keys.ts`, and — only if the decision itself changes — `src/check.ts`.

## Database independence

**The module never opens a connection.** It has no `@prisma/client` dependency,
reads no `DATABASE_URL`, and holds no client of its own. `PermissionsService`
depends on `PermissionsPrismaClient` — a structural interface — and the host app
injects whatever satisfies it. Two apps consuming this module can therefore sit
on two completely different databases, and neither knows about the other's.
A test can inject a plain object with no database at all.

What each consuming app **does** owe the module: its database must have the
`perm_*` tables. Compose `prisma/permissions.prisma` into that app's schema and
run its migrations. The fragment is the module's contribution to a schema it does
not own — models are prefixed `Perm` and mapped to `perm_*` precisely so they can
drop into any app's schema without colliding.

`PermSubjectRole` references the subject by id with **no foreign key**, for the
same reason: the module must not own the identity model, and the users it grants
against may live in a table — or a service — it has never heard of.

## One constraint worth knowing

**GraphQL hooks are generated app-side.** The module's resolvers are part of the
schema the server emits, so generating typed hooks *inside* this package would
need the schema that this package helps produce — a build cycle. The module
therefore ships `.graphql` documents and presentational components; apps add
`packages/module-*/src/graphql/*.graphql` to their codegen `documents` glob. If
typed hooks must live in the module, split it into `module-permissions` and
`module-permissions-web`; the DAG then resolves cleanly.
