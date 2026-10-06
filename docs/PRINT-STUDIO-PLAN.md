# `module-print-studio` — plan

Status: **the studio is built, 2026-10-05** (§9 phases 1–8; checking it on real
paper is the operator's). Steps 2 and 3 (§10, §11) are not built. The contract
is in `packages/module-print-studio/README.md` and the decision in PLAN §13.

## Built, and where it differs from this plan

- **A document's pages are COPIED into the result, and DRAWN only for the
  preview.** The result copies each page as it is (`pdf-lib`), which keeps text
  sharp. The preview draws the real pages with `pdfjs-dist`, added at the
  operator's request (2026-10-05) after first being left out for its size: it
  is loaded only when a PDF is opened, and run on the main thread through the
  hook the library provides (`globalThis.pdfjsWorker`), so the app serves no
  worker file. Sheet by sheet, with Previous / Next and zoom. A page that
  cannot be drawn shows as its number in a box, and still prints.
- **Cropping is four "trim" sliders**, not a box dragged over the photo: exact,
  and it works in a panel of any width.
- **The click layer over the sheet is real buttons**, positioned by
  percentages, not SVG shapes — a cell is then focusable and named for a
  screen reader with no workaround.
- **A result is dropped when the arrangement changes.** Not in the plan, and
  needed: a file that no longer matches the screen must not be downloadable
  as if it did.
- **Print stays mounted** while another section is open, because it holds the
  photos.
- **Calibration takes two measurements and two shifts**; the scale is worked
  out, never typed. The ruler's lines are shorter than 100 mm on a small paper
  (70 mm on a 4R), and the page says how long they are.
- **`studio.prune_logs` counts workspaces PRUNED, not visited**, so the same
  early workspaces cannot use the budget up every night.
- **Three tests guard "print and go"**: no field on the API could carry a file,
  the web half writes to no browser storage, and it reaches the network only
  through the JSON client.
- **Checked in a real browser** (headless Chrome, the module's own rendering
  code): a 4R result is a 288 × 432 pt PDF, its sheet 1200 × 1800 px, and a
  1 × 1 cell exactly 300 px wide starting 35 px in — the 3 mm margin.
- **No Playwright test and no click-through**: the seed account has two-step
  verification, which the harness does not support (as for notes and the Apps
  page).
- **The presets are the operator's own thirteen layouts, grouped by tag
  (2026-10-06).** The studio first shipped seven A4 strips built by the
  editor's packing tools (2026-10-05); the operator then drew what they
  actually print and asked for those instead. Seven **ID** packages (1 × 1,
  1.5 × 1.5, 2 × 2, passport, and three mixes) sit in the top half of an A4
  with 12 mm sides, so the lower half is used again; six **Photo Print**
  sheets (2R, wallet, 3R, 4R, 5R, 6R) use the whole sheet with 9 mm sides.
  A fourteenth, added the same day, is ten PVC ID cards (54 × 85.6 mm) on a
  whole sheet, tagged ID. A third tag, **Page Grid**, holds five whole-A4
  grids of equal cells inside 3 mm margins: Full, 1x2, 2x2, 2x3 and 3x3
  (columns × rows).
  All keep **24 mm clear at the bottom**, and their cells **touch, with no
  gap**, so one cut separates two photos. They are written out as positions,
  exactly as saved. Each has a tag from `STUDIO_PRESET_TAGS`, and both screens
  show one "Ready-made" shelf per tag. A new layout still starts on A4 with
  12 mm sides and 3 mm top and bottom (`defaultLayoutSpec`).
- **The editor's equal grid is under "Add cells" (2026-10-06)**, beside "Your
  own size": quick picks, across and down, a gap, and a picture of the result.
  It replaces every cell and asks first when there are any.
- **A cell's label is sized to stay inside its cell (2026-10-06)**, by its
  length as well as the cell's size (`cellLabelSize`).
- **Any layout can carry one tag (2026-10-06).** Typed in the editor beside
  the name, with the tags already in use offered; stored in
  `studio_layout.tag`. Both screens group "My layouts" and "Shared" by it,
  the untagged last (PLAN §13, 2026-10-06).
- **Several cells can be selected, and every action applies to all of them**,
  by the operator's request after trying it (2026-10-05). Ctrl, ⌘ or Shift
  with a press adds a cell or takes it out; two buttons select every cell
  holding the same photo, or every filled cell, across pages. Zoom, position,
  turn, reset, "empty" and "put the picked photo here" then reach the whole
  selection, and the panel's title says how many cells that is. (A first
  version offered an "Apply to" switch instead; selecting cells replaced it.)
- **The screens were rebuilt to be easier to use, by the operator's request
  after trying it (2026-10-05).** They found the first version "hard to grasp
  and control", the layout editor's controls most of all.
  - **The layout editor is a drawing board**, not three boxes of fields. A
    palette of sizes on the left: press one to add it, or drag it onto the
    sheet to put it exactly there; "how many at a time" (across, down, gap)
    adds a block in one go (`addBlock`), and "Fill" fills the rest of the
    sheet. Cells are dragged, resized by a corner, nudged with the arrow keys
    and removed with Delete; the selected cell's exact numbers and Copy / Turn
    / Remove sit above the sheet. Paper and margins fold into one line.
  - **Choosing a layout to print with happens on the Print tab**, as pictures
    of the sheets — yours, shared ones, ready-made ones. The Layouts tab is
    for making and managing them.
  - **The first photos fill the sheet by themselves**: one photo into every
    cell, several one per cell. Only while every cell is empty.
  - **A photo is dragged inside its cell** to move it (`panFrame`); the
    two position sliders are gone. Zoom, Turn and Reset are a toolbar above
    the sheet, and act on every selected cell.
  - **Download and Print make the result themselves.** The separate "Make the
    result" step and its second bar were removed (`OutputBar`).
  - **Colours on the sheet are literal**, not theme tokens: the theme's primary
    is nearly white on a dark theme, and a near-white cell on white paper could
    not be seen.
  - **The sheet always fits its panel**, both ways (`SheetFrame`), so a tall
    paper never scrolls.
  - **The sheet can be zoomed** in the editor and on the Print tab: buttons in
    its corner, or Ctrl (⌘) with the mouse wheel, up to 600%, scrolling inside
    the panel. For placing cells and photos precisely; it changes nothing in
    the layout or the result. On the Print tab a zoomed sheet is drawn finer,
    up to the result's own 300 dpi.
  - **Shortcut keys, with a bar at the bottom, as the point of sale has.**
    Delete empties the selected cells; + and − zoom; R turns; 0 resets; the
    arrows move the photo; S and Ctrl+A select; 1 2 3 arrange; D downloads and
    P prints. The editor has its own (Delete, D to copy, R to turn, the
    arrows, + − 0 for the view). The bar shows only the keys that do something
    RIGHT NOW, from the same function the keys obey (`view/keys.ts`), and each
    entry can be clicked.
  - **The keys are a workspace setting**, changed on a new Shortcuts tab by
    whoever holds the new key `studio:manage_settings` (`StudioSettings`,
    `domain/keymap.ts`, the point of sale's design copied structurally).
    Everybody reads them. The arrows and Esc are fixed; no key the browser
    needs can be taken (Ctrl+P, Ctrl+S, F5…); one action per key on a screen.
    ⚠ Unlike the point of sale's, the bar cannot be hidden: that preference
    lives in browser storage there, and the studio writes to none.
  - **The border around the cells can be chosen** — solid or dashed, five
    thicknesses from a hairline to 2 mm, grey or black — because a pale design
    on white paper has no edge to cut along. Saved with the layout (the
    editor's "Border and more"), and changeable for one print on the Print
    screen without touching the layout. A layout saved before this has no
    `border` and prints the same hairline it always did (`DEFAULT_BORDER`).
    The line is centred on the cell's edge, and ⚠ each shared edge is drawn
    ONCE (`borderSegments`): drawn per cell, two touching cells' dashes fall
    out of step and the line between them prints solid.
  - **Photos are kept when switching to a document and back**: the photo
    screen is hidden, not unmounted.
  - These were checked in SCREENSHOTS of the real screens, driven by a
    temporary preview page with fake data (not committed). Dragging — a size
    onto the sheet, a photo inside its cell — was not exercised that way; its
    arithmetic is unit-tested.
- ⚠ **§3's example was wrong**: with 3 mm margins only TWO 2 × 2 fit on a 4R,
  not four — two inches twice is the sheet's whole width.

## 1. What it is

A **layout studio** for a print shop, run as a sub-app on the workspace's Apps
page. Staff make a **layout** (a paper, its printable area, and cells dividing
that area), then drop photos into it and get a result file at exact physical
sizes: sheets of ID photos (1×1, 2×2, passport, and combinations), photo sizes
(2R to 8R) and office papers (A4, short and long bond).

It is **print and go**: photos and the result file live in the browser's
memory only. Nothing is uploaded, and nothing but layouts, calibration
profiles and a basic log is saved.

Three steps, in this order. Only the first is this module:

1. **The print studio** (`module-print-studio`, this plan's detail). Output is
   a **PDF download** and the **browser's print dialog**.
2. **A printing module and its agent** (`module-print` and `apps/print-agent`):
   a small program on the shop computer that prints silently on the printers
   installed there (§10). A SEPARATE module: composing a page and getting it
   onto paper are two features, and the studio will reach it through a port.
3. **Receipts** for other modules, starting with `module-basic-pos`, through
   that same printing module (§11).

PLAN §12.66 named the reason step 2 exists: "browsers cannot reach [a printer]
without a local bridge". The studio needs no bridge, which is why it is first.

## 2. Decisions (from the operator, 2026-10-05)

| # | Question | Decision |
|---|---|---|
| 1 | Name | `module-print-studio`, shown as "Print Studio": `Studio*` models, `studio_*` tables, `studio:*` keys. It lays out and edits as well as prints, so plain "print" undersold it. `module-print` is kept free for step 2 |
| 2 | Who uses it | Shop staff only, behind sign-in. No public page |
| 3 | Who sees a layout | **Private** to its maker, or **shared with the workspace** |
| 4 | Making a layout | In this order: paper size → printable area → cells |
| 5 | What goes in a cell | **Images only.** PDFs and documents never go into a layout |
| 6 | Filling a layout | By hand per cell; the same photo in every cell; or many photos in order, adding pages with the same layout for the rest |
| 7 | File types | JPG (and `.jfif`), PNG, WebP, HEIC, and GIF as a still (its first frame; added 2026-10-06) in layouts; PDF in a separate whole-page mode. Office documents later |
| 8 | Files | **Temporary.** Never saved on the server or in the database. The result can be downloaded before it is cleared |
| 9 | Image tools | Basic only: crop, resize, rotate and flip, lighting (brightness, contrast, saturation, warmth, black and white). No text, borders or retouching: that is done in other software |
| 10 | A print log | Yes: who, when, which layout, paper, pages, copies, and the **file names**. Never the files |
| 11 | Devices | Desktop only for now |
| 12 | Borderless printing | Not for now |
| 13 | Order of work | Studio → agent → receipts |

Decided while planning:

| # | Question | Decision |
|---|---|---|
| 14 | What a layout stores | The **exact cells drawn**, not a list of sizes to pack again. A layout never re-flows by itself |
| 15 | Editing a shared layout | Its **owner** only; others use it or **duplicate** it. `studio:manage_all` may edit and delete other people's shared layouts. An edit to a shared layout changes everybody's next print, so it is not open to every writer as a shared note is |
| 16 | Private means private | **No key reveals another person's private layout**, `manage_all` included. It is `not_found` everywhere |
| 17 | Limit | **Per person** (`studio:layouts`). A workspace-wide cap could be filled by private layouts no admin can see or delete |
| 18 | Units | Stored as whole **hundredths of a millimetre**. Overlap checks then never fail on rounding, and 1 inch is exactly 2540 |
| 19 | A fourth way to fill | **One photo per page**: each photo fills every cell of its own page. The usual case for several customers' ID photos |
| 20 | Custom sizes | Typed into the layout. No saved list of a workspace's own sizes yet |
| 21 | Calibration | A named profile (scale and offset) made from a measured ruler page, because printers and print dialogs scale slightly |
| 22 | Log retention | 90 days, a module option, pruned by a declared process |
| 23 | Main output | **Download**, with "print at 100%" said beside it. The browser's Print is secondary: some browsers ignore the page size a page asks for |

## 3. What the person does

**Making a layout**

1. **Paper**: a built-in paper or a typed width and height; portrait or
   landscape. Built-ins, with the names used in the Philippines:
   - Office: A4 (210×297 mm), A5, **Short bond** / Letter (8.5×11 in),
     **Long bond** / Folio (8.5×13 in), Legal (8.5×14 in).
     ⚠ Long bond and Legal are different papers; shops call both "long".
   - Photo: 2R (2.5×3.5 in), 3R (3.5×5), 4R (4×6), 5R (5×7), 6R (6×8),
     8R (8×10), S8R (8×12).
2. **Printable area**: the four margins. The preview shades what cannot print.
3. **Cells**: divide the printable area, with three tools that work together:
   - *Fill with a size*: as many 1×1 (or any size) as fit, with a gap.
   - *Add some of a size*: "4 of 2×2", placed into the free space. Doing it
     again with another size makes a combination (2×2s, then 1×1s in what is
     left).
   - *Split into a grid*: rows × columns of equal cells.
   - Then by hand: drag, resize, type an exact size, delete. A cell cannot
     overlap another or leave the printable area.

   Built-in cell sizes: 1×1 in, 1.5×1.5 in, 2×2 in, passport 35×45 mm, wallet
   2×3 in, and any paper size (a 2R cell on an A4; 2R is the other size sold as
   "wallet"). ⚠ The passport size is to be checked against the current DFA
   requirement before it ships.

Then name it and choose **Private** or **Shared with the workspace**.

**Using a layout**

1. Pick one of your layouts, a shared one, or a shipped preset.
2. Choose photos. They are read in the browser and never uploaded.
3. Fill the cells: by hand; the same photo in every cell; many photos one per
   cell (a new page with the same layout is added for the rest); or one photo
   per page.
4. Adjust: per cell, move, zoom and rotate; per photo, the image tools of
   decision 9 (every cell using that photo follows). A cell whose photo falls
   below about 150 dpi at that size warns that it may print blurry.
5. **Make the result**: a PDF held in memory. Download it or print it, as
   often as wanted.
6. **Done** clears the result and the photos, asking once whether to download
   first if that has not happened. Closing or reloading the page clears
   everything too. Nothing is written to `localStorage` or IndexedDB.

**Whole-page mode** (PDFs and single images, no layout): paper, fit / fill /
actual size, pages per sheet, page range. PDF pages are copied as they are, so
text stays sharp. Built last.

## 4. Keys, limit and presets (`src/feature-keys.ts`)

All workspace level. **The bindings are the guard**, and
`surface-coverage.test.ts` fails on an unbound operation.

| Key | Lets you |
|---|---|
| `studio:read` | Open the studio; use your layouts, shared ones and presets; your own calibration profiles; write and read **your own** log entries |
| `studio:write` | Create, edit, share, unshare, duplicate and delete your own layouts |
| `studio:manage_all` (privileged) | Edit and delete other people's **shared** layouts; read **everyone's** log. No binding of its own: checked through `STUDIO_ACCESS_CHECK` |

- Limit `studio:layouts`: plan-sourced, counted **per person**, default 100.
- Presets: `studio-user` (read, write) and `studio-admin` (all three).

## 5. Schema (`prisma/studio.prisma`)

Every row carries `organizationId` and `workspaceId`, and every lookup by id
also names the workspace. `userId`s are bare strings.

- **`StudioLayout`**: `ownerId`, `name`, `visibility` (`private` | `workspace`,
  default `private`), `spec Json`, `version`, `updatedById`, timestamps. The
  spec is validated by `checkLayoutSpec` on every write: the database holds
  only what the domain accepted.
- **`StudioCalibration`**: `ownerId`, `name`, scale X/Y and offset X/Y. Its
  maker's only.
- **`StudioLog`**: `userId`, `action` (`downloaded` | `sent_to_print`), the
  layout's id and a copy of its name, paper name and size, `pages`, `copies`,
  `fileNames String[]`, `createdAt`.
  - ⚠ `sent_to_print` means the browser's dialog was opened. A browser never
    tells a page whether paper came out. The agent can log a real `printed`.
  - ⚠ A file name is often a customer's name (`juan-dela-cruz.jpg`), so this
    table is personal data: names are capped in count and length, rows are
    pruned after 90 days, and none of it may reach the public
    `seed-data/snapshot.json`.

## 6. Domain (`src/domain/`, pure)

| File | Holds |
|---|---|
| `units.ts` | Hundredths of a millimetre; inches, pixels at a dpi, PDF points |
| `papers.ts`, `sizes.ts` | The built-in papers and cell sizes, as data |
| `layout.ts` | The spec, the printable area, `checkLayoutSpec`, name rules |
| `place.ts` | The editor's tools: fill with a size, add some of a size, split into a grid, move, resize |
| `fill.ts` | `planFill`: which photo goes in which cell of which page, for the four ways of filling |
| `slot-fit.ts` | How a photo fills a cell (cover, offset, zoom, rotation), or is placed freely inside it, and its effective dpi |
| `adjust.ts` | The lighting tools as arithmetic on pixels, so the preview and the result agree |
| `calibration.ts` | Scale and offset from a measured ruler page |
| `log.ts` | What a log entry may hold, and its caps |
| `access.ts` | Who may see, use, edit, share and delete a layout |
| `presets.ts` | Shipped layouts to copy, and the tags they are grouped by |
| `page-layout.ts` | The whole-page mode's arithmetic |

## 7. Server (`src/server/`)

One resolver class, `declareScope('workspace')`. Ports: `STUDIO_PRISMA`,
`STUDIO_PRISMA_WRITE`, `STUDIO_LIMIT_CHECKER` (unbound: the declared default,
never unlimited), `STUDIO_ACCESS_CHECK` (unbound: you act on your own only),
`STUDIO_MEMBER_DIRECTORY` (unbound: no names). One error class,
`StudioWriteError`. One process, `studio.prune_logs`.

No public surface, no upload and no realtime yet. A shared layout
somebody else changed shows on reopening.

## 8. Web (`src/react/`)

One sub-app, `StudioApp` (label "Print Studio", key `studio:read`), with sections:
**Print** (the studio), **Layouts** (mine, shared, presets, the editor),
**History** (the log, in the workspace's time zone) and **Calibration**. The
editor is desktop-first and asks for more room in a narrow box.

Rendering is in the browser: each sheet is drawn on a canvas at 300 dpi and
written into a PDF at the paper's exact size (`pdf-lib`); `heic2any` decodes
HEIC on demand; `pdfjs-dist` reads PDFs for the whole-page mode.

## 9. Phases (one commit each)

1. This plan.
2. The domain, with tests.
3. Schema, server, app wiring, migration, sync.
4. The layout editor; mine and shared.
5. Using a layout: photos, filling, adjusting, pages, image tools.
6. The result: download, print, the ruler page, calibration, the log.
7. Whole-page mode for PDFs.
8. README, PLAN §13 and §12, the other docs.

## 10. Step 2, `module-print` and the print agent (not built)

A separate module, `module-print` (agents, printers, the job queue), and
`apps/print-agent`, a Node CLI on the shop computer. The studio declares a
port (`STUDIO_PRINTER`) and the app binds it; unbound means Download and the
browser dialog only, as in step 1. It connects **out** to the
server, so the shop opens no port. Designed while planning:

- **Access** copies the queue's TV display: a one-time pairing code is
  exchanged for a long secret stored hashed, presented when the agent opens
  its `graphql-ws` socket. New here: the secret outlives a session and must be
  revocable, and `app.module.ts` admits only the queue's displays on that path
  today, so the hook has to be composed by connection-parameter key.
- **It discovers the printers the OS has installed**, wireless and USB alike,
  with their papers and printable areas. No per-printer setup on the computer.
- **Exact-size printing through a Windows driver is the first thing to prove**,
  with the ruler page, on real printers. The agent must run under Windows Node:
  WSL does not see Windows printers.
- ⚠ **To decide then**: decision 8 says files are never saved on the server.
  Reaching an agent means the result crosses the server. An **in-memory relay**
  keeps the rule, but the agent must be online at that moment and a job cannot
  wait in a queue. Holding it in the database until printed allows queuing and
  does save the file briefly.

## 11. Step 3, receipts (not built)

A receipt document and its ESC/POS renderer in `module-print`, a `PrintSender`
on `/server`, and `module-basic-pos` printing through a `POS_PRINTER` port it
declares (modules never import each other; the precedent is the books reading
POS sales through `BOOKS_SALES_SOURCE`). The till's Print button sends to the
agent when it has a printer and falls back to today's browser print; a POS
setting prints automatically on payment.

## 12. Not in this module yet (→ PLAN §12 when built)

- Margins are typed by hand; the agent will read them from the printer.
- Exact size depends on printing at 100%.
- A reprint tomorrow means choosing the photos again.
- The log cannot know that paper came out.
- A departed member's private layouts stay, unseen by anyone.
- No borderless printing, no text or borders on photos, no phone or tablet
  editor, no office documents, no saved list of custom sizes.
- Colour is not managed: photos are treated as sRGB.
- Shared layouts are not live.
