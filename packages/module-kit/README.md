# @kwtech/module-kit

The contract every `module-*` package implements and every app composes. An app
lists its modules **once**; routes, navigation, middleware, REST endpoints,
GraphQL schema and the seed registry all derive from that list. Adding the tenth
module is the same one-line edit as adding the second.

Runtime dependencies: none at the root entry point. `react` is type-only and
optional there; Nest modules are carried as opaque values, so this package never
imports Nest. The React bindings for the status channel are a separate
`@kwtech/module-kit/react` entry point, so importing `composeFeatures` from a
Nest app still pulls in no renderer.

## Server — automatic, natively

Nest already does this: a module's `controllers` and resolver `providers` are
registered when the app imports it. `module-kit` only removes the per-module
boilerplate around that.

```ts
// apps/web-server/src/modules.ts
export const SERVER_MODULES = [
  permissionsServerModule({
    imports: [DbModule],
    prismaProvider: { provide: PERMISSIONS_PRISMA, useExisting: PrismaService },
    resolvePrincipal: (req) => {
      const r = req as { user?: { id: string }; orgId?: string; workspaceId?: string };
      return r.user ? { userId: r.user.id, organizationId: r.orgId, workspaceId: r.workspaceId } : undefined;
    },
  }),
  // usersServerModule({ ... }),
];

// apps/web-server/src/app.module.ts
@Module({
  imports: [
    ...serverModuleImports(SERVER_MODULES),
    RouterModule.register(serverRoutePrefixes(SERVER_MODULES)),
  ],
})
export class AppModule {}
```

That single list gets you, per module and with no further wiring:

- **REST routes** registered — and picked up by `@nestjs/swagger`, so they land
  in `openapi.json` and the frontend's generated REST types for free.
- **GraphQL resolvers** joined into the code-first schema. No SDL, no stitching.
- **Guards and services** available for injection.
- **Feature contributions** for the seed task: `composeFeatures(SERVER_MODULES)`.

## Web — the honest version

**Next.js cannot do this natively.** The App Router discovers routes from the
filesystem under `app/`; there is no plugin API, and a package cannot inject a
route. What a module *can* own is everything except the file: the page component,
its path, its title, its required feature and its nav entry — all declared as
data in `WebModuleDescriptor`.

```ts
// apps/web-app/src/modules.ts
export const WEB_MODULES = [permissionsWebModule /*, usersWebModule */];
export const ROUTES = composeRoutes(WEB_MODULES);
```

Navigation and route protection then genuinely are automatic, and derive from the
same declaration — which is what stops a menu linking somewhere the guard refuses:

```ts
const nav = composeNav(WEB_MODULES, grants?.features);   // filtered, grouped, sorted
const route = matchRoute(ROUTES, request.nextUrl.pathname);  // in middleware.ts
if (route?.feature && !held.includes(route.feature)) return forbid();
```

Three ways to get the pages themselves rendered:

| | How | Cost |
|---|---|---|
| **A. Catch-all** *(start here)* | one `app/(modules)/[[...slug]]/page.tsx` resolving `matchRoute(ROUTES, …)` | truly zero per-route work; gives up per-route `metadata`, `generateStaticParams`, segment config and nested layouts — everything under it is one segment |
| **B. Thin re-export** | one file per route: `export { RolesPage as default } from '@kwtech/module-permissions/react'` | a real Next route with full static analysis; one 1-line file per route, written by hand |
| **C. Generated stubs** | a `routes:sync` script writes B's files from `ROUTES` | B's fidelity with A's ergonomics; costs a generation step in the build and generated files in the tree |

**Recommendation:** A while routes are few and uniform, C once they multiply or
need per-route metadata. B only for the handful of routes that want hand-written
segment config. Note that A, B and C differ *only* in how the file gets there —
the module, the descriptor and every helper above are identical in all three, so
switching later is a mechanical change and never a module rewrite.

## Adding a module

Export two descriptors and nothing else changes:

```ts
export const usersServerModule = (opts) => ({ key: 'users', nestModule: UsersModule.forRoot(opts), features: [...] });

export const usersWebModule: WebModuleDescriptor = {
  key: 'users',
  features: [...],
  // Where this module's group sits in the drawer. See below.
  navGroups: [{ group: 'People', order: 30 }],
  routes: [
    { path: '/users', title: 'Users', component: UsersPage, feature: 'members:manage',
      nav: { group: 'People', order: 10, icon: 'users' } },
  ],
};
```

The app adds it to `WEB_MODULES` and stops. Routes, navigation, group placement,
middleware protection and the seed registry all follow.

Duplicate route paths and duplicate feature keys **throw at composition time**,
not at first request: two modules quietly owning one path is exactly the failure
this package exists to catch.

## Navigation groups

`composeNav` can only sort group NAMES, alphabetically, so group placement used
to be a hand-written array in the app — which meant adopting a module was a
one-line edit *plus* a second edit nobody would think of, and forgetting it
silently dropped that module's group to the bottom of the drawer.

`navGroups` moves that onto the descriptor:

```ts
const groups = composeNavGroups([...WEB_MODULES, { key: 'app', navGroups: [{ group: 'Overview', order: 10 }] }]);
entries.sort((a, b) => navGroupRank(groups, a.group) - navGroupRank(groups, b.group) || …);
```

Two rules, and both are deliberate:

- **The lowest order wins for a shared group.** Duplicate routes and feature
  keys throw, because two modules owning one of those is a bug. A group is the
  opposite — `Administration` is *meant* to collect entries from several modules
  — so two modules naming a position for it is normal. Taking the minimum makes
  the result independent of the order modules are listed in, which is the
  property that matters: `[a, b]` and `[b, a]` must produce the same drawer.
- **An unplaced group sorts last, not first.** A new module whose group nobody
  positioned appears at the bottom, which is visible and harmless. Ranking it
  first would put an unknown module's pages above the dashboard on the day it
  was installed.

Space the numbers — 10, 50, 90 — so a group can be inserted between two others
without renumbering anything.

A module says *what* it contributes and roughly where. It never says which
chrome draws it: `module-auth` places `Account` at 90, and this app lifts that
group out of the drawer entirely and renders it in the header's account menu.

## Three declarations: features, limits, defaults

A module declares three kinds of thing that a *different* module resolves. All
three shapes live here, for one reason: **every module declares them, only one
module answers them**, and the resolver may not import its contributors.

| Declaration | Composed by | Answers |
|---|---|---|
| `FeatureContribution` | `composeFeatures` | may this be done |
| `LimitContribution` | `composeLimits` | how many of these may exist |
| `DefaultContribution` | `composeDefaults` | what happens when nobody said |

Each is a looser shape than the spec the resolver narrows it to — `kind`,
`moment`, `countedOver` and `bindings.surface` are plain strings — because this
package must not own the resolving module's vocabulary. The narrow happens once,
in the app, where a bad value is a boot failure.

**⚠ An undeclared one does not exist.** The resolver reads the composed
registry, so a row in its table for a key nobody declared is ignored, and the
screen that sets it has no control to offer. Setting the value in the database
changes nothing, with no error to explain why.

### Defaults also need their MOMENT declared

The defaults screen groups by *moment* — somebody arrives asking "what happens
when a group is created", not "which of these point at a role" — so a default
needs a section to appear in, and `DefaultMomentContribution` is that section:

```ts
defaults: CHAT_DEFAULT_REGISTRY,           // the decisions
defaultMoments: CHAT_DEFAULT_MOMENT_REGISTRY,  // the headings they appear under
```

`composeDefaultMoments` resolves these the way `composeNavGroups` resolves nav
groups, and for the same reason — a moment is a shared namespace, and two
modules may have a default at one:

- **The lowest order wins**, so the result does not depend on module order.
- **An undeclared moment sorts last**, and its section renders *unnamed* rather
  than not at all. That is the important half: a module that declared a default
  and forgot the heading gets a visible section titled with the raw moment key,
  not a setting that silently never appears on the only screen it can be set
  from.

## Dynamic route segments

A route path may carry `:params`, and whatever renders the route hands them to
the component as `ModuleRouteProps.params`:

```ts
{ path: '/admin/features/:featureId/edit', title: 'Edit feature', component: FeatureEditPage }
```

```tsx
export function FeatureEditPage({ params }: ModuleRouteProps) {
  const id = params?.featureId; // already URL-decoded
}
```

Resolve with `matchRouteWithParams(routes, pathname)`, which returns
`{ route, params }`. `matchRoute` is the same thing without the params, for
callers that only need to know which route a path belongs to.

**Literal segments outrank dynamic ones**, whatever order the routes are
declared in. `/admin/features/new/manual` beats `/admin/features/:featureId/edit`
because a literal segment scores higher than a `:param` at every position — the
alternative is a route that works until somebody reorders `WEB_MODULES`.

A `:param` matches exactly ONE non-empty segment, so a binding cannot swallow a
deeper path: `/admin/features/:featureId` does not match
`/admin/features/new/manual`. When nothing matches exactly, the pre-existing
prefix behaviour still applies — a route may own everything beneath it, longest
prefix winning.

Encode a value that can contain a colon, which every feature key does:

```tsx
`/admin/features/${encodeURIComponent(key)}/edit`   // -> billing%3Amanage
```

## Feature access, for modules that are not the enforcer

`@kwtech/module-permissions` ships `FeatureGate` and `usePermissions`, and they
are the right tools — for that module. Every other module is forbidden from
importing it, so a module wanting to hide its own control had no way to ask the
question: it could gate a ROUTE through the descriptor, but not a button inside
its own page.

The contract lives here; the answer is supplied by whoever resolves permissions.

```tsx
import { useHoldsFeature, useHoldsAllFeatures, useHeldFeatures } from '@kwtech/module-kit/react';

const canEdit = useHoldsFeature('account:profile_write');
return canEdit ? <SaveButton /> : <p>Your profile is managed for you.</p>;
```

`PermissionsProvider` mounts `FeatureAccessProvider` internally, so an app that
already renders it gets this for free and there is exactly one source of the
list. An app with no permission model at all sees an empty list rather than a
crash — a missing provider HIDES controls, it never reveals them.

**Not a security boundary.** Hiding a control hides an affordance, not an
endpoint; the request is authorised again at the API.

## The status channel

The global status bar's vocabulary lives here for the same reason
`FeatureContribution` does: **every module has something to say, and exactly one
component renders it.**

Putting the channel in a feature module — `module-auth` was the obvious
candidate, since it owns the session — would force every other module to import
that one just to publish a sentence, which is the cycle the module rules exist
to prevent.

The root entry point carries the vocabulary and the store, with no React:

```ts
import { selectPrimaryStatus, type StatusMessage } from '@kwtech/module-kit';
```

`@kwtech/module-kit/react` carries the bindings:

```tsx
import { PublishStatus, StatusProvider, useStatusChannel } from '@kwtech/module-kit/react';
```

A page publishes declaratively, and it retracts on unmount:

```tsx
<PublishStatus level="warning" text="Read-only: your plan has expired" source="billing" />
```

or imperatively, from an event handler:

```tsx
const status = useStatusChannel();
status.publish({ id: 'import', level: 'error', text: 'Import failed.' });
```

`<PublishStatus>` renders nothing, so a **server** component can render it —
which is the only way a server-rendered page contributes to the bar.

### What the app owns

Where the bar is, what it looks like, and when transient messages are cleared.
A module says what is true; it does not decide where that appears. An app that
never mounts a `StatusProvider` still runs every module unchanged — publishing
falls through to an inert store rather than throwing, because adopting a module
must not be conditional on adopting the status bar.

### Sticky versus transient

`sticky: true` survives navigation and cannot be dismissed. It is for a
**condition** — a server that is unreachable is not a property of the route you
happen to be on, and letting someone close it would hide a fact that is still
true. Everything else is news: cleared when the route changes, dismissible while
it is up.
