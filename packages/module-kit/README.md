# @kwtech/module-kit

The contract every `module-*` package implements and every app composes. An app
lists its modules **once**; routes, navigation, middleware, REST endpoints,
GraphQL schema and the seed registry all derive from that list. Adding the tenth
module is the same one-line edit as adding the second.

Runtime dependencies: none. `react` is type-only and optional; Nest modules are
carried as opaque values, so this package never imports Nest.

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
export const usersWebModule: WebModuleDescriptor = { key: 'users', routes: [...], features: [...] };
```

Duplicate route paths and duplicate feature keys **throw at composition time**,
not at first request: two modules quietly owning one path is exactly the failure
this package exists to catch.
