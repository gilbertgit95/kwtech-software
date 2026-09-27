# @kwtech/module-app-hub

A workspace's **Apps page**: every sub-app the viewer holds (the queue today),
in **tabs** or side by side in a **grid** of up to six cells, with a saved
**workspace default** layout and a **per-person** override of it.

The plan and every decision behind it: [`docs/APP-HUB-PLAN.md`](../../docs/APP-HUB-PLAN.md).

## In a Next.js app

```ts
// src/modules.ts
const FEATURE_MODULES = [authWebModule, permissionsWebModule, /* … */ queueWebModule({ wsUrl })];
export const WEB_MODULES = [...FEATURE_MODULES, appHubWebModule({ apps: composeApps(FEATURE_MODULES) })];
```

That contributes `/organizations/:organizationId/workspaces/:workspaceId/apps`,
gated on `app_hub:read`, listed as **Apps** in the drawer's **Workspace** section
(order 15: after Overview, before Members). Sub-apps are not in the drawer at
all; this page is the way in.

The page is handed the apps as data and never imports one (PLAN §9 rule 5). A
sub-app is declared by its own module, in `apps` on its descriptor — see
`packages/module-kit/README.md`, "Sub-apps".

⚠ **The route adapter renders each app into an element** for the workspace in
the URL. The adapter runs on the server and the page is a client component: a
component function cannot cross to it, an element can.

## In a NestJS app

```ts
// src/app.module.ts — one entry in SERVER_MODULES
appHubServerModule({
  prismaProvider: appHubPrismaProvider, // { provide: APP_HUB_PRISMA, useExisting: PrismaService }
  resolveActorId: (request) => resolvePrincipal(request)?.userId,
}),
```

| Option | Unbound means |
|---|---|
| `prismaProvider` | the service cannot be constructed: the boot fails |
| `resolveActorId` | every operation refuses with "Not signed in" |

No ports: the guard has already answered who is asking and whether they are a
member of the workspace (every operation is bound, so it checks membership).

Compose `APP_HUB_FEATURE_REGISTRY` in `seed/registry.ts`. ⚠ Leave it out and the
bindings never load: anybody signed in could save a layout into any workspace.

## Vocabulary

- **App**: a sub-app another module declares (`AppContribution`). Its `key` is
  saved in layouts; never rename one.
- **Held**: the viewer holds the app's `feature` in this workspace. Only held
  apps are offered.
- **Cap**: the most cells the viewer's grid may have, `min(6, apps held)`.
- **Main view**: the working window, the first column's single cell (cell 0).
  Every other cell is a **secondary view**, an extension of it.
- **Preset**: a grid people pick (`GRID_PRESETS`), given as each column's cell
  count: `[1, 2]` is the main view with two stacked beside it.
- **Source**: whose layout is on screen — `user`, `workspace` (the default) or
  `default` (built in).

## The domain entry point

`@kwtech/module-app-hub` exports the layout rules, pure, used by the page and
the server alike: `GRID_PRESETS`, `presetOf`, `hasMainView`,
`startingColumnSizes`, `cellCap`, `isColumnsAllowed`, `cellPosition`,
`cellIndex`, `emptyGrid`, `DEFAULT_GRID_COLUMNS`, `defaultLayout`, `validateLayout` (the write rule),
`readLayout` (lenient read, which also converts version 1), `effectiveLayout`
(whose layout, fitted to what is held), `reshape`,
`resizeTracks`, `assignCell`, `swapCells`, `reorderTabs`, `moveTab`.

## The views

- **One toolbar, no page header.** The page has no visible title (an `sr-only`
  `h1` stays for screen readers). A single row holds the tabs, or in the grid
  the app list toggle and the presets, on the left; saving, the Tabs / Grid
  switch and the layout menu (⋮, which also says whose layout this is) are
  always on the right. Grid borders show a centred ellipsis, so they read as
  draggable.
- **Tabs**: one tab per held app, reordered by dragging (or Ctrl+Shift+← / →).
  Never added or closed: the tabs are exactly the apps held.
- **Grid**: pick a **preset** from a row of icons, each drawn as its layout
  with the main view filled in. Every preset has a main view in the first
  column, starting wider (two thirds beside one column of secondary views, half
  beside two), and up to five secondary views: `[1]`, `[1,1]`, `[1,2]`,
  `[1,1,1]`, `[1,3]`, `[1,4]`, `[1,2,2]`, `[1,5]`. **Until somebody picks one,
  the grid is `[1,2]`** (`DEFAULT_GRID_COLUMNS`): the main view with two
  stacked beside it, or `[1,1]` / `[1]` for a viewer with fewer apps. Presets over the cap are
  disabled with the reason. A secondary view's menu has "Make this the main
  view". Column borders resize columns; the borders between stacked cells
  resize that column only. Drag a cell by its header to swap, drag an app from the list onto a
  cell, drag the borders to resize (or focus one and use the arrow keys). The
  cell menu has "Move to…" for keyboard and touch.
- **Apps are rendered once, in one CSS grid**, and a view only changes where
  each sits. Switching views, swapping cells and reordering tabs never remount
  an app, so the queue console keeps its state and socket.
- **Narrow screens** show the tabs without changing the saved view.

## Saved layouts

- A person's layout saves itself shortly after each change (one drag is one
  write). "Use the workspace's default layout" deletes it.
- `app_hub:layout_manage` saves the current layout as the **workspace default**,
  or removes it. People's own layouts are left alone either way.
- A layout is JSON text on the wire, validated by `validateLayout` on every
  write. A stored layout that no longer validates reads as absent.
- ⚠ **Version 2** stores the grid column by column (`columns`, `columnSizes`,
  `rowSizes` per column, `cells` in column order). Version 1 (uniform
  `rows × columns`) is converted on read, so no saved layout is lost. The check
  is structural, not "is it a preset": a converted two-by-two still renders,
  with no preset chosen and no main view.
- A saved grid wider than the viewer's cap is narrowed **for display only**, so
  access coming back restores it.

## What it declares

| Key | Level | Guards |
|---|---|---|
| `app_hub:read` | workspace | the page, `appHubLayouts`, `saveMyAppHubLayout`, `resetMyAppHubLayout` |
| `app_hub:layout_manage` | workspace | `saveWorkspaceAppHubLayout`, `resetWorkspaceAppHubLayout` |

Tables: `app_hub_workspace_layout` (one row per workspace) and
`app_hub_user_layout` (one per person per workspace) — two tables, so a
workspace cannot have two defaults.

The page is **free**: `plans.ts` puts both keys in every plan. ⚠ Plans that
already exist need an operator on `/admin/plans` to add them.
