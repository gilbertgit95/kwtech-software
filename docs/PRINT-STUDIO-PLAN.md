# `module-print-studio` — plan

Status: **the studio is built, 2026-10-05** (§9 phases 1–8; checking it on real
paper is the operator's). Step 2 (§10) is built except calibration through
the agent; step 3 (§11) is not built. The contract
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

## 10. Step 2, `module-print` and the print agent (built; calibration through the agent is not)

**Built (2026-10-07):** a computer is paired with a one-time code, connects
out with its secret, says it is still there, and reports its printers with
their papers and printable areas; the web app lists them and revokes a
computer. A job is sent through the in-memory relay and its state read back;
the Printers page prints a ruler page; and the studio prints a result on a
chosen printer through its port (`StudioPrinterPort`, bound in the web app's
`providers.tsx`, where this plan said `STUDIO_PRINTER`).

**Checked for real (2026-10-07), with the agent's fake driver:** pairing, the
socket, a 24 MB file through the web app's handler arriving byte for byte,
every refusal, revoking; and the studio's Print pressed in a real browser
against a stand-in for the API.

**On paper, through the agent itself (2026-10-07, later the same day):** the
agent ran under Windows Node, paired with the server in WSL over `localhost`
(the socket too, which the proof below had not opened), and printed one ruler
page on each of the operator's printers, on A4:

| Queue | Driver | Paper the job named | Margins it reported |
|---|---|---|---|
| `L5290 Series(Network)` | EPSON L5290 Series | `A4 210 x 297 mm` | about 3 mm all round |
| `EPSON L120 Series` (the USB printer) | Epson ESC/P Standard 10 V4 Class Driver, Windows' own | `A4` | 3 mm, and 14 mm at the bottom |

The operator measured both and found them accurate (no figures were given).
So the USB printer prints at exact size through Windows' generic driver, and
the question left under "Seen in the printer list" below is answered for A4:
`EPSON L120 Series` is the queue Windows binds to the device, and it works.
⚠ The pairing code and the two jobs were made by a script calling the
server's services, because a scripted sign-in is not possible; the buttons on
the Printers page and in the studio were not pressed by it.

**Paper type and quality, and the Printers button (2026-10-07, after the
operator's first photos through the agent).** A job names a paper type and a
quality from the driver's own lists; the studio has Print, Printers and
Download, and choosing a printer opens its settings for that print. The first
photos on `Epson L5290 Dye Ink` came out 2.8% enlarged because that queue's
preferences in Windows fit every page onto a 8.5 × 13 inch paper. The
operator set that queue back to A4, and its prints then came out the same
size as the USB printer's (seen on paper, 2026-10-07); the agent does not
check for this, on the operator's decision. (Windows' "User-Defined"
paper slot, which the page had also been matched to, is no longer reported.)
PLAN §13 has the decision and §12.115 its cost. ⚠ Paper type and quality
were set, read back and restored on both Epson drivers; a photo printed with
a chosen paper type has not been looked at on paper yet.

**Not built:** calibration through the agent, a job's outcome in the studio's
history (it records `sent_to_print` and nothing more). **Not proven on
paper:** a landscape sheet, a paper other than A4, and the `EPSON L110 Series`
queue (Epson's own driver for the USB printer, which offers 23 papers where
the generic one offers 2). How to run what exists is in `apps/print-agent/README.md`
and `packages/module-print/README.md`; where the sections below differ from
them, the READMEs are right.

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
- **The result crosses the server through an in-memory relay** (decided
  2026-10-07, PLAN §13). Decision 8 says files are never saved on the server,
  and the relay keeps that: the server passes the bytes on and holds none.
  ⚠ The cost: the agent must be online at that moment and a job cannot wait
  in a queue. Holding it in the database until printed would allow queuing
  and would save the file briefly; that was turned down.

### The proof on a real printer (2026-10-07, passed on the L5290)

Run from WSL against the operator's own Windows, with a throwaway script
outside the repository.

- **Windows → the server in WSL works through `localhost`**: a request from
  the Windows side to `http://localhost:8080/api/v1/graphql` answered 200. The
  socket was not opened.
- **The .NET helper idea holds.** `System.Drawing.Printing.PrinterSettings`,
  called through PowerShell, returned for `L5290 Series(Network)` the default
  paper (A4), the printable area (about 3 mm in from every edge) and 28
  papers.
- ⚠ **`pdf-to-printer`'s `getPrinters()` returned only 4 of those 28 papers.**
  It is not a source for a printer's papers; the helper is.
- **One vector ruler page was sent** with `scale: "noscale"`, `paperSize:
  "A4"`. The spooler took it (`Printing, Retained`, 1 page) and it left the
  queue within seconds.
- **It is exact.** The operator measured the two 100 mm lines and the 20 mm
  and 30 mm distances from the paper's edges and found the page accurate (no
  figures were given). So `pdf-to-printer` with `noscale` stands for printing
  through Epson's own driver; the .NET helper need not draw pages.
- **Not proven**: any other printer or driver, the USB printer among them,
  and a paper other than A4.
- **Seen in the printer list**: the USB printer appears as `EPSON L110 Series`
  and as `EPSON L120 Series` on the same port, the second on Windows' generic
  ESC/P class driver, and no queue is named L121. To sort out before that
  printer is tested.

### Packages (researched 2026-10-07, from READMEs and the npm registry; none run)

Node has no printing API of its own, and no one package covers the agent. The
recommendation is **`pdf-to-printer` for the pages, one small PowerShell/.NET
helper for what it cannot do, and no native addon**. It is a recommendation,
not a decision: the ruler page on real printers decides it.

| Job | Choice | Why |
|---|---|---|
| Print the studio's PDF at exact size | `pdf-to-printer`, `scale: "noscale"` | Maintained (5.8.1, 2026-08); bundles SumatraPDF and prints through the real Windows driver, so USB and wireless alike |
| List printers, read papers and printable areas | a PowerShell/.NET script the agent calls | No healthy Node package reads a printable area on Windows; `pdf-to-printer` returns paper NAMES only |
| Know whether a job finished | the same script (`Get-PrintJob`) | The spooler's status means "the printer accepted it", not strictly "paper came out" |
| Receipts (step 3) | `@point-of-sale/receipt-printer-encoder` | It only builds the bytes, so the renderer can live in `module-print` and the agent only delivers |
| Deliver receipt bytes | Node's `net` (TCP 9100) for network printers, the .NET helper for USB ones | Still no native addon |

- **Not the node-printer forks** (`printer`, `@thiagoelg/node-printer`,
  `@grandchef/node-printer`, `@alexssmusica/node-printer`): the original is
  abandoned since 2019 and the newest fork has almost no users. They are
  compiled addons, and on Windows they send only `RAW` or `TEXT`: no PDF
  through the driver, and reading a driver's papers is POSIX only.
- **Not IPP first** (`ipp`, `@sealsystems/ipp`): it asks the printer itself
  for media, margins and job states, with no driver, but only for printers
  that speak it, which leaves out many USB-only ones. It can be added later.
- **Not `node-thermal-printer`**: a healthy package, but it builds AND sends,
  and sending to a printer installed in Windows brings a node-printer fork
  back in.
- **If `noscale` is not exact on real printers**, the .NET helper draws the
  page itself. The helper exists anyway for margins and status, so that is an
  extension of it and not a redesign.

### Setting up a computer (as designed; command and page names are illustrative)

Written for the operator's own two printers: an Epson L5290 on Wi-Fi and an
Epson L121 on USB.

**Needs.** A 64-bit Windows 10 or 11 computer that stays on while the shop
prints, with both printers reachable from it; A4 paper and a millimetre ruler;
Epson's own driver for each printer; Node >= 22 **for Windows**, pnpm and git.
PowerShell and .NET ship with Windows, and SumatraPDF comes inside
`pdf-to-printer`.

1. **Install both printers in Windows with Epson's drivers.** Windows often
   adds a wireless printer by itself with a generic Microsoft driver, which
   may report other margins and scaling options; check the L5290's driver in
   its properties and replace it if so.
2. **Confirm Windows sees them**: a Windows test page from each, then
   `Get-Printer` in PowerShell. A printer missing there is missing for the
   agent too.
3. **Install Node and pnpm on Windows**, and check `node -v` in PowerShell,
   not in a WSL terminal.
4. **Clone the repository to a Windows folder** (not a path inside WSL),
   `pnpm install`, and build `apps/print-agent`.
5. **Start the server as today**: check `pnpm env:show`, then `db:migrate`,
   `db:sync` (so `module-print`'s keys exist) and `pnpm dev`.
6. **Make a pairing code** in the web app: the workspace's printers page, add
   a computer. It shows a one-time code.
7. **Pair the agent**: `print-agent pair <code>`. The server is the one in
   its `.env` (`API_URL`, `WS_URL`); there is no `--server`. It exchanges the
   code for the long secret and stores it on the computer.
   Windows normally reaches a server running in WSL through `localhost`.
8. **Start it**: `print-agent start`. It connects out, reads the installed
   printers and reports them; both appear in the web app with their papers
   and margins, nothing typed by hand.
9. **Print the ruler page on each printer and measure it.** Set that
   printer's calibration if it is slightly off. Once per printer.
10. **Print a real layout** from the studio to either printer. The history
    now says how the job ended, not only `sent_to_print`.
11. **Make it start with Windows**, as a startup task or a service.

### The agent's `.env` (proposed)

**As built**, the agent reads `APP_ENV`, `API_URL`, `WS_URL`,
`PRINT_AGENT_STATE_DIR`, `PRINT_AGENT_EXCLUDE_PRINTERS` and
`PRINT_AGENT_DRIVER` (`windows` or `fake`; not in the proposal). Two rows
below differ: `PRINT_AGENT_NAME` was dropped, because the name is given in the
web app with the pairing code, and `PRINT_AGENT_EXCLUDE_PRINTERS` left empty
hides the printers Windows adds itself (`none` reports all).
`PRINT_AGENT_TEMP_DIR`, `PRINT_AGENT_SUMATRA_PATH` and `LOG_LEVEL` arrive
with printing, if at all. `WS_URL` must be on the same host and port as
`API_URL`.

Named as the two apps' templates are. It would get an
`apps/print-agent/.env.example` and its validation in
`apps/print-agent/src/config/env.ts`. Only `API_URL` and `WS_URL` are
required.

| Variable | Default when empty | For |
|---|---|---|
| `APP_ENV` | `local` | which profile this is, as in the other apps |
| `API_URL` | none, required | the server, `http://localhost:8080/api/v1` locally |
| `WS_URL` | none, required | its socket, `ws://localhost:8080/api/v1/graphql` locally |
| `PRINT_AGENT_NAME` | the computer's hostname | the name this computer shows under in the web app |
| `PRINT_AGENT_STATE_DIR` | `%APPDATA%\kwtech-print-agent` | where the agent keeps what pairing gave it |
| `PRINT_AGENT_EXCLUDE_PRINTERS` | none hidden | printers to hide, comma separated: Windows lists virtual ones too (`Microsoft Print to PDF`, `Fax`) |
| `PRINT_AGENT_TEMP_DIR` | the OS temp folder | where a PDF is written for the moment it prints |
| `PRINT_AGENT_SUMATRA_PATH` | the bundled SumatraPDF | only to replace the bundled one |
| `LOG_LEVEL` | `info` | |

- **The agent's secret is NOT in it.** The server issues it at pairing, so
  nobody types it; the agent stores it in its state folder, and revoking it in
  the web app ends it. In a `.env` it would be copied between computers and
  into backups.
- **Nor is the pairing code**: it is one-time, so it is a command argument.
- **Nor are the printers, their papers and margins**: the agent reads them
  from Windows each time it starts.
- **Nor is calibration**: it belongs to the printer and is stored on the
  server, so it survives reinstalling the agent.
- ⚠ **The temp folder touches decision 8.** `pdf-to-printer` prints from a
  file path, so the PDF is on the shop computer's disk for a moment. That is
  the shop's own computer and not the server, but the file must be deleted
  right after the job, and when the job fails too.
- **Outside `localhost` the URLs must be `https://` and `wss://`**: the agent
  refuses to present its secret over a plain connection.

### About the operator's two printers

- **One agent serves both printers**: the computer is paired, not each printer.
- **Both are reached through this computer's drivers**, the wireless one
  too. With the computer off, both are offline to the app.
- **Both are A4 inkjets, not receipt printers.** They serve the studio;
  step 3 needs a thermal ESC/POS printer.

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
