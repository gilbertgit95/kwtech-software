# `module-app-hub` — plan

Status: **built, 2026-09-27** (phases 1–7; the browser check of the embedded
queue is the operator's). The contract is in `packages/module-app-hub/README.md`
and the decision in PLAN §13. This file stays until that check is done, then is
deleted.

## Built, and where it differs from this plan

- **Keys are `app_hub:*`, not `app-hub:*`.** A feature key's area is
  `[a-z][a-z0-9_.]*`; the role editor refuses a hyphen.
- **A fifth operation, `resetWorkspaceAppHubLayout`**, so an admin can remove the
  default as well as set it. Bound to `app_hub:layout_manage`.
- **Both keys go to the organization admin role too** (not only
  `layout_manage`), matching how that role already carries workspace keys.
- **A lost app's cell names both possible reasons** rather than one (§12.74).
- **The drawer icon is `blocks`**, already in the app's icon set.
- **No Playwright test yet.** The seed account has two-step verification, which
  the e2e harness does not support.
- **With one sub-app the grid is 1×1.** The cap is the number of apps held, so
  multi-cell grids appear once a second sub-app exists; the rules are unit tested.

## 1. What it is

One page per workspace where a person uses **several sub-apps at once**, without
navigating between pages: the queuing window today, and every sub-app after it.

- **`/organizations/:organizationId/workspaces/:workspaceId/apps`**, one entry
  **Apps** in the drawer's **Workspace** section, after Overview
  (Overview, Apps, Members, Settings).
- Two views, switched in the page header: **Tabs** and **Grid**.
- The layout is saved on the server: a **workspace default**, and a **per-user
  override** of it.
- The page is **free**: its own keys are in every plan. Each app keeps its own
  keys and plan gating, and the page offers only the apps the viewer holds.

It **replaces** the drawer's "Apps" section (PLAN §13, 2026-09-25). Sub-apps are
no longer listed in navigation at all; this page is the way in. Their own URLs
keep working (links from notifications, the queue's public TV display).

## 2. Decisions (from the operator, 2026-09-26)

| # | Question | Decision |
|---|---|---|
| 1 | What is "6 divisions" | **At most 6 grid cells in total** (rows × columns ≤ 6) |
| 2 | Where the layout is saved | Server. A workspace default, and each user may override it for themselves |
| 3 | The same app twice | **No.** One instance of an app at a time, in the grid and in tabs |
| 4 | What a tab or cell shows | **The full app**, not a compact version |
| 5 | Navigation | The "Apps" drawer section is removed; one **Apps** entry in Workspace. Apps are visible only inside this page |
| 6 | Plan gating | **Free.** Access control stays on each app |
| 7 | Which tabs exist | **Every app the viewer holds**, one tab each. Tabs are reordered, never added or closed |
| 8 | Default grid | **2 cells, 1×2 (side by side)**, the first two apps in tab order. **1×1** when the viewer holds one app |
| 9 | Shapes offered | Capped by the number of apps held: shapes with more cells than that are **disabled** |
| 10 | A module of its own? | **Yes**: it has its own data, rules, API, keys and page (PLAN §9 rule 8) |
| 11 | Name | `module-app-hub`: models `AppHub*`, tables `app_hub_*`, keys `app_hub:*` |
| 12 | Who sets the workspace default | **Whoever holds `app_hub:layout_manage`**, a feature assignable to any role. For now it is granted to the admin roles (workspace admin, organization admin) |

## 3. Tab view

- One tab per app the viewer holds in this workspace, in the saved order. An app
  the order does not mention (new, or newly granted) is appended at the end.
- **Drag a tab to reorder it.** A marker shows where it lands; Esc cancels.
  Keyboard: a focused tab moves with a shortcut, and its menu has Move left /
  Move right.
- No add, no close: the set of tabs is exactly the set of apps held.
- **An app mounts the first time its tab is opened and then stays mounted**
  (hidden, not unmounted), so switching back keeps its state and its socket.
  Mounting all ten at page load would open ten apps' queries and sockets for a
  person who looks at one.
- Too many tabs to fit: the bar scrolls sideways, with an overflow menu.

## 4. Grid view

- The viewer chooses **rows and columns**. The cell cap is
  **`min(6, apps held)`**, one function in the module's pure core, used by the
  picker, the page and the server's validation.

  | Apps held | Default | Shapes offered |
  |---|---|---|
  | 0 | none: "No apps in this workspace yet" | none |
  | 1 | 1×1 | 1×1 |
  | 2 | 1×2 | 1×1, 1×2, 2×1 |
  | 3 | 1×2 | + 1×3, 3×1 |
  | 4 | 1×2 | + 2×2, 1×4, 4×1 |
  | 5 | 1×2 | + 1×5, 5×1 |
  | 6+ | 1×2 | + 2×3, 3×2, 1×6, 6×1 |

  A disabled shape says why ("You have 3 apps").
- **Resizing:** a vertical border resizes its columns across every row, a
  horizontal border its rows across every column, so the grid stays a grid. Each
  track has a minimum size. Built as a CSS grid with our own drag handles:
  nested split-pane libraries resize each row independently, which is not this.
- **Assigning an app:** the cell header's picker, or drag an app from a
  collapsible app list onto a cell (replacing what was there). An empty cell
  shows "+ Choose an app". An app already in the grid is not offered again.
- **Moving:** drag a cell **by its header** onto another cell to swap them, or
  onto an empty cell to move. Only the header is the handle, so work inside an
  app never starts a drag. The header menu has "Move to…" for keyboard and touch.
- **A moved app keeps running.** Cells are rendered as one list keyed by app,
  and placed with CSS grid areas, so moving changes the placement, not the
  React tree. A remount would drop the queue console's state and socket.
- **Shrinking the shape** keeps the apps that still fit, in reading order, and
  asks before dropping any.
- On narrow screens the grid falls back to the tab view.

## 5. Rules when the world changes

- **An app the viewer lost:** its tab disappears. A grid cell holding it shows
  the reason (`not_granted` / `not_entitled`), and the rest keeps working.
- **A saved grid larger than the cap** (access lost, or an admin's 2×3 default
  seen by someone with 3 apps): the **display** shrinks to the largest allowed
  shape that keeps the apps still held. The saved layout is **not** rewritten,
  so access coming back restores it. It changes only when the viewer changes it.
- **An app key nobody declares** (an app removed from the product): ignored on
  read, never an error (principle 4).

## 6. The layout

> **Superseded in part (2026-09-27, PLAN §13):** the grid is now version 2,
> column by column, picked from presets that each have a main view in the first
> column. The rows × columns model below is version 1, which is converted on
> read. See `packages/module-app-hub/README.md`.

One JSON document, versioned, validated on write and read leniently:

```ts
interface AppHubLayout {
  version: 1;
  view: 'tabs' | 'grid';
  tabs: { order: string[]; active: string | null };      // app keys
  grid: {
    rows: number;
    columns: number;
    rowSizes: number[];      // fractions, one per row, summing to 1
    columnSizes: number[];   // fractions, one per column
    cells: (string | null)[]; // app key or empty, reading order, rows × columns long
  };
}
```

App keys double as instance ids, which is safe only because an app appears once
(decision 3). Allowing duplicates later means adding a cell id.

**Pure functions in `src/domain/`, each unit tested:** `cellCap`,
`allowedShapes`, `validateLayout`, `reshape`, `resizeTrack`, `assignCell`,
`clearCell`, `swapCells`, `reorderTabs`, `defaultLayout(appsHeld)`,
`effectiveLayout(user, workspace, appsHeld)` (the viewer's layout, else the
workspace default, else the built-in default, then clamped to what is held).

## 7. Schema

Two tables, so "two defaults for one workspace" cannot be stored. One table with
a nullable `userId` cannot express it, because Postgres treats nulls as distinct
in a unique index.

```prisma
model AppHubWorkspaceLayout {
  workspaceId String   @id
  layout      Json
  updatedBy   String            // bare userId, no FK (principle 10)
  updatedAt   DateTime @updatedAt
  @@map("app_hub_workspace_layout")
}

model AppHubUserLayout {
  workspaceId String
  userId      String
  layout      Json
  updatedAt   DateTime @updatedAt
  @@id([workspaceId, userId])
  @@map("app_hub_user_layout")
}
```

## 8. API

Every resolver declares `declareScope('workspace')` and takes `organizationId`
and `workspaceId`.

| Operation | Key | Does |
|---|---|---|
| `appHubLayout` | `app_hub:read` | The viewer's layout and the workspace default, both raw; the page computes the effective one (it knows which apps the viewer holds) |
| `saveMyAppHubLayout` | `app_hub:read` | Upsert the viewer's layout. The page saves on change, debounced |
| `resetMyAppHubLayout` | `app_hub:read` | Delete the viewer's layout, falling back to the default |
| `saveWorkspaceAppHubLayout` | `app_hub:layout_manage` | "Save as workspace default", from the current layout |

The server validates shape (cap of 6, sizes, cell count, no duplicate key). It
does not check app keys against a list: it has no web descriptors, and unknown
keys are ignored on read anyway. The per-viewer cap (apps held) is a display
rule, not a write rule, so an admin can save a default wider than one member's
apps.

## 9. Keys, roles, plans

| Key | Level | Granted to | Plans |
|---|---|---|---|
| `app_hub:read` | workspace | `workspace-user`, `workspace-admin` | every plan, `free` included |
| `app_hub:layout_manage` | workspace | `workspace-admin`, `organization-admin` | every plan |

- **The key is the rule, not the role.** Nothing in the module checks for
  "admin". It asks for `app_hub:layout_manage`, so any custom workspace role can
  be given the right in the role editor. The admin grants above are only the
  starting presets.
- An organization-level role may carry a workspace-level key
  (`canRoleGrant`), and it applies **only in workspaces the person is a member
  of**. There is no route into a workspace without membership
  (`module-permissions` `domain/grants.ts`), so an organization admin sets a
  default only where they belong. That is intended.
- ⚠ "Free" means the key is in every plan. Environments already seeded need an
  operator on `/admin/plans`, because `createPlanIfAbsent` does not add keys to
  existing plans (the same note as §12.61).

## 10. `module-kit`: how a module declares its app

A new optional field on `WebModuleDescriptor`:

```ts
apps?: readonly {
  key: string;            // unique across modules; composition throws on a duplicate
  label: string;
  icon: IconName;
  description: string;
  feature: string;        // workspace-level key; the page offers the app only to holders
  order?: number;         // default tab order before anyone reorders
  component: ComponentType<{ organizationId: string; workspaceId: string }>;
}[];
```

- `composeApps(WEB_MODULES)` collects them, like `composeNav`.
- `apps/web-app` passes the composed list to `appHubWebModule({ apps })`, so
  `module-app-hub` never imports a sub-app (PLAN §9 rule 5).
- The component must work in a box of any size, and must not change the
  browser URL to move between its own screens.

## 11. The queue, embedded

- Declare its app in the descriptor (`queue`, the console as the component).
- **Its screens switch inside the panel.** The console's Settings button is a
  plain `<a href>` (`queue-console-page.tsx:42`), which would leave the Apps
  page. Embedded, it switches to settings in place, with a back control.
- **Container queries, not viewport breakpoints** (Tailwind 4 `@container`), so
  it lays out by the cell's width.
- Remove its drawer entry and its `navGroups` 'Apps' placement. The routes stay:
  the console and settings for direct links, the display for TVs.

## 12. Drawer

- `module-app-hub`'s descriptor adds `{ group: 'Workspace', order: 15 }` for
  Apps (Overview 10, Members 20, Settings 30). It spells `'Workspace'`
  structurally and pins it in a test, as the queue did.
- Remove `APPS_NAV_GROUP` from `module-permissions/src/react/tenant-nav.ts`,
  its placement at 35, and its entry in `apps/web-app/src/components/layout/nav.ts`'s
  scoped set.

## 13. Dependencies

- **`@dnd-kit/core` + `@dnd-kit/sortable`** (new, via the pnpm catalog): tab
  reordering, cell swapping, and dragging from the app list, with mouse, touch
  and keyboard. HTML5 drag and drop has no touch or keyboard support.
- No layout library: the grid is CSS grid plus two kinds of drag handle.

## 14. Phases

1. **`module-kit`:** the `apps` contract, `composeApps`, the duplicate check, tests.
2. **`module-app-hub` core:** package scaffold, feature keys, layout types and
   domain functions with tests.
3. **Server:** schema fragment, repository, service, resolvers, operations;
   tests against a fake client.
4. **React:** the page, tab view, grid view, app list, layout controls, saving.
5. **Queue embedded:** app declaration, in-panel settings, container queries,
   drawer entry removed.
6. **Wiring:** both apps' `package.json`, `app.module.ts`, `module-clients.ts`,
   `satisfies-modules.ts`, seed `registry.ts`, `app-roles.ts`, `plans.ts`,
   `modules.ts`, `nav.ts`; `db:migrate`, `db:sync`.
7. **Docs:** module README, `module-kit` README ("Apps"), queue README, CLAUDE.md
   checklist (a sub-app declares `apps`, not an 'Apps' nav entry), PLAN §13
   superseding 2026-09-25.
8. **Verify:** `pnpm typecheck`, `pnpm test`, `pnpm lint`; run the app and try
   both views, drag, resize, both saved layouts and the fallbacks; a Playwright
   test for the page.

## 15. Not doing, and why

- **The same app twice.** Decision 3. The layout is ready for it (add a cell id).
- **Iframes per panel.** Each would load the whole web app with its own sign-in
  and sockets. Apps render in the page.
- **Free-form splitting** (tmux style). The operator asked for rows × columns.
- **Named or multiple saved layouts** ("Morning", "Busy day"). Not asked for.
- **Compact app views.** Decision 4: the full app.
