# @kwtech/module-print-studio

A layout studio for a print shop, run as a **sub-app** on the workspace's Apps
page (`module-app-hub`). Staff make a **layout** — a paper, its printable area,
and the cells that divide it — then put photos in the cells and get a PDF at
exact physical sizes: sheets of ID photos, photo sizes, combinations. A PDF
document is printed as whole pages instead.

It is **print and go**: photos, documents and the result live in the browser's
memory only. **No file is ever uploaded or stored.** What the server keeps is
layouts, calibration profiles and a print history of file **names**.

The plan and the decisions behind it: `docs/PRINT-STUDIO-PLAN.md`. The decision:
PLAN §13, 2026-10-05. Printing silently on a shop's own printers (a print
agent) and receipts for other modules are a separate module, not built.

## In a Next.js app

```ts
// apps/web-app/src/modules.ts
import { studioWebModule } from '@kwtech/module-print-studio/react';
const FEATURE_MODULES = [..., studioWebModule()];
```

It contributes one sub-app (key `studio`, "Print Studio", icon `printer`, order
70), no routes and nothing in the drawer. The app must know the icon name
`printer` (`apps/web-app/src/components/layout/nav-icons.ts`).

It lays out by the width of its BOX, not the screen. The layout editor is
desktop-first and asks for more room in a narrow box.

Five sections: **Print** (photos in a layout, or a document), **Layouts** (your
own, shared ones, presets, and the editor), **History**, **Calibration** and
**Shortcuts** (the workspace's keys).
Print stays mounted while another section is open, because it holds the chosen
photos and nothing else does.

Rendering is in the browser: `pdf-lib` writes the result; `pdfjs-dist` draws a
PDF's pages for the document preview, and `heic2any` decodes HEIC photos —
each of those two loaded only when needed. **Photos accepted:** JPG (also
as `.jfif`, what a photo downloaded from Messenger is saved as — the shop's
most common file), PNG, WebP, HEIC/HEIF, and GIF as a still (its first
frame); a PDF only as whole pages (`isPhotoFile`, `STUDIO_PHOTO_ACCEPT`). All three are this package's own
dependencies, and none needs a file served by the app (`pdfjs-dist` runs on
the main thread, with no worker URL).

## In a NestJS app

```ts
studioServerModule({
  prismaProvider: studioPrismaProvider,
  prismaWriteProvider: studioWritePrismaProvider,
  limitCheckerProvider: { provide: STUDIO_LIMIT_CHECKER, useExisting: PermissionsLimitChecker },
  accessCheckProvider: { provide: STUDIO_ACCESS_CHECK, useFactory: … },
  memberDirectoryProvider: { provide: STUDIO_MEMBER_DIRECTORY, useFactory: … },
  resolveActorId: (request) => resolvePrincipal(request)?.userId,
  logRetentionDays: 90,
})
```

| Port / option | Asked | Unbound means |
|---|---|---|
| `STUDIO_PRISMA`, `STUDIO_PRISMA_WRITE` | every read and write | the module cannot start |
| `STUDIO_LIMIT_CHECKER` | when a layout is created or duplicated | the **declared default** cap (100), never unlimited |
| `STUDIO_ACCESS_CHECK` (`holdsManageAll`) | only to change somebody ELSE's SHARED layout, or read everybody's history | **no**: you act on your own only |
| `STUDIO_MEMBER_DIRECTORY` | names beside shared layouts and history entries | no names: "a member" |
| `logRetentionDays` | by `studio.prune_logs` | 90 days |

Also add the registries to `seed/registry.ts` (`features`, `limits`,
`processes`), grant the presets in `seed/app-roles.ts`, sell the keys in
`seed/plans.ts`, and keep `studio_log` out of the public dev snapshot
(`seed/snapshot.ts`).

**Not live.** There is no subscription: a shared layout somebody else changed
shows when the Layouts section is opened again.

## Vocabulary

| Word | Means |
|---|---|
| **Unit** | every length is a whole number of **hundredths of a millimetre**; an inch is exactly 2540 (`src/domain/units.ts`) |
| **Paper** | a built-in size (A4, short bond, long bond, legal, 2R–8R, S8R) or a typed one, always stored portrait |
| **Printable area** | the sheet less its four margins — what the printer can reach |
| **Cell** | one place a photo goes, measured from the printable area's top left |
| **Layout** | a paper, an orientation, margins, the EXACT cells drawn, and the border printed around them |
| **Border** | the line around each cell, to cut along: on or off, solid or dashed, a thickness, grey or black. Saved with the layout; the Print screen can change it for one print |
| **Tag** | what kind of work a layout is for ("ID", "Photo Print"): ONE per layout, free text of at most 30 characters, or none. The screens show the layouts of one tag together, the untagged last. Compared without case or spacing (`studioTagKey`), so two spellings are one shelf |
| **Cell label** | the size's name written on a cell in the editor. Its font size comes from the cell AND the label's length (`cellLabelSize`), so a long one ("54 × 85.6 mm") stays inside its own cell |
| **Private / shared** | `visibility`: `private` (the owner only, whatever keys anyone holds) or `workspace` |
| **Preset** | a layout that ships with the studio: the operator's own ID packages and photo sheets on A4, written out exactly as they drew them. Each has a **tag** (`STUDIO_PRESET_TAGS`: ID, Photo Print, Page Grid — the last being whole-A4 grids of equal cells) and the screens show one Ready-made shelf per tag (`studioPresetGroups`). Using or copying one makes no row |
| **Frame** | how a cell shows its photo: zoom, position, a quarter turn. Kept per cell, and changed for every SELECTED cell at once: several can be selected, on any page. In the toolbar (a rail down the left edge of the preview), − and + zoom a point (1%) a press and repeat while held, and the slider's scale is proportional (`view/zoom-slider.ts`), as fine at 100% as at 400%; it runs 100–400% (10–400% placed freely), the buttons reach the rest. The zoom KEYS still step 10% |
| **Free placement** | a frame marked `free`: the photo no longer has to cover its cell. It can be any size down to 1% and anywhere in the cell, past the cell's edge too, but the CELL still cuts it: only the photo moves, never the layout. Off by default; switched per selection in the toolbar, and switching never moves the photo |
| **Rulers** | optional rulers on the top and left EDGES of the Print preview's panel (photos and documents), in mm, cm or inches. They stay on the panel while the sheet scrolls and zooms under them, read from the paper's edge (the frame measures the element marked `data-studio-paper`), mark the selected cell, and follow the mouse: a line on each ruler where the pointer is, with a tag reading its exact distance from the paper's edge (`rulerReading`). Chosen from the view's floating bar, off by default, and held IN MEMORY only (the studio writes nothing to browser storage), so they are off again after a reload. Screen only: never printed |
| **Pager** | the pages (or a document's sheets), floating in the preview's bottom left corner opposite the zoom: previous, at most seven numbers with "…" for the rest (`pagerItems`), next. For photos, "Add a page" and Remove sit beside it |
| **Print screen layout** | `StudioSplit`: the settings in a column beside the sheet, the output card (copies, calibration, Print, Download) pinned under them, and the sheet's card the whole height of the panel, with its selection toolbar a rail of icons down its left edge (the zoom slider upright), so the toolbar takes width the sheet was not using and no height. The photos-or-PDF switch is the first thing in the settings column. Nothing else shares the sheet's column, so a whole page shows without scrolling. A narrow panel stacks settings, sheet, output and scrolls |
| **Photo edit** | what was done to a PHOTO — crop, flips, lighting — followed by every cell holding it |
| **Result** | the PDF made in the browser, held in memory until downloaded or cleared |
| **Calibration profile** | one person's scale and shift for one printer and paper, from a measured ruler page |

## The domain entry point

`@kwtech/module-print-studio` is pure: no Prisma, Nest or React.

- **Making a layout** (`place.ts`): `addBlock` (rows × columns of a size,
  placed together, at a dropped point or the first free place), `addAt`,
  `fillWithSize`, `addOfSize`, `splitIntoGrid`, `moveCell`, `resizeCell`,
  `rotateCell`, `duplicateCell`, `snapPosition`. Deterministic; run only in the editor.
  In the editor's "Add cells" card, **Equal grid** is `splitIntoGrid` with a
  live picture: so many across, so many down, an optional gap. ⚠ It replaces
  every cell, and asks first when there are any.
- **What may be saved** (`layout.ts`): `prepareLayoutSpec` rebuilds a spec from
  known fields and bounds every number. It is the only way a spec reaches the
  database, and the same `checkCells` the editor runs.
- **Filling** (`fill.ts`): `planFill` for the four ways — the same photo in
  every cell, one per cell in reading order (adding pages), one photo per page,
  or by hand.
- **Framing and editing** (`slot-fit.ts`, `adjust.ts`): `sourceRect`,
  `panFrame` (a photo dragged inside its cell), `effectiveDpi`, and lighting as arithmetic on pixels so the preview and the
  result agree. Free placement: `freeRect` (where a free photo lies),
  `keepInCell` (half of it always left in its cell), `setFreePlacement` (on or off
  without the photo jumping), `zoomFrameBy` and `resetFrame` (which keep the
  switch).
- **Tags** (`tags.ts`): `prepareLayoutTag` (what may be saved),
  `groupByStudioTag` (the shelves) and `studioTagSuggestions` (what the editor
  offers). ⚠ On `updateStudioLayout`, leaving `tag` out keeps it and an EMPTY
  STRING takes it off. The editor's tag box is the module's own combobox
  (`TagInput`), not an `<input list>`: it offers the tags in use, and what is
  typed is the value.
- **Who may** (`access.ts`): `canSeeLayout`, `planChangeLayout`,
  `checkShareLayout`. ⚠ Somebody else's private layout is `not_found` from every
  check, and no key overrides that.
- **Documents** (`page-layout.ts`): `parsePageRange`, `sheetSlots`,
  `placeInSlot`.
- **Calibration and the history** (`calibration.ts`, `log.ts`).
- **Shortcut keys** (`keymap.ts`): `STUDIO_KEY_ACTIONS`, `STUDIO_DEFAULT_KEYMAP`,
  `validateStudioKeymap` (run by the settings screen AND the server),
  `effectiveStudioKeymap` (a saved keymap over the defaults; never trusts what
  was stored), `studioKeyOfPress`. The arrows and Esc are fixed and not in the
  map.

## Rules worth knowing

- **Only the owner edits a shared layout.** Anybody else duplicates it; a
  holder of `studio:manage_all` may edit and delete it. Sharing and unsharing
  are the owner's alone.
- **A stale save is refused**, with `STUDIO_CONFLICT_MESSAGE`. Never merged.
- **A result is of the arrangement it was made from.** Change a photo, a frame,
  the copies or the calibration and the result is dropped.
- **Download is the main output.** The saved PDF printed at 100% is the size
  the layout says; the browser's own print dialog may rescale or ignore the
  page size.
- **The history never says "printed".** It records `downloaded` or
  `sent_to_print`; a browser cannot know paper came out.
- **A file name is personal data.** `fileNames` are capped, stripped of any
  folder path, and pruned.
- `test/web-module.test.ts` fails if the web half touches browser storage, or
  reaches the network anywhere but the JSON API client.

## Processes

| Process | Does | Default | Limits |
|---|---|---|---|
| `studio.prune_logs` | deletes print history older than `logRetentionDays` | daily at 03:00, each workspace's own time | at most hourly; 2,000 workspaces pruned a run; 120 s |

Paused, old history stays until it runs again. It tells nobody and returns
counts only. Nothing is ever "too late" to prune.

## What it declares

| Key | Lets you |
|---|---|
| `studio:read` | open the studio; use your layouts, shared ones and presets; your own calibration profiles; write and read your own history |
| `studio:write` | create, edit, share, unshare, duplicate and delete your own layouts |
| `studio:manage_settings` | change the workspace's shortcut keys, for everybody |
| `studio:manage_all` (privileged) | edit and delete OTHER people's SHARED layouts; read everybody's history. No binding of its own — checked through `StudioAccessCheck` |

There is **no key that reads another person's private layout**.

- Limit `studio:layouts`: plan-sourced, counted **per person**, default 100.
- Role presets: `studio-user` (read, write), `studio-admin` (all four).
- Models: `StudioLayout`, `StudioCalibration`, `StudioLog`, `StudioSettings`
  (`prisma/studio.prisma`).
