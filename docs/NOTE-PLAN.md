# `module-note` — plan

Status: **planned, 2026-09-28.** Grows the placeholder (`note:read`, a static
screen; PLAN §13, 2026-09-27) into the real notes app, in place. The package,
the key `note:read` and the app key `note` (saved in people's layouts) are kept.
When it is built, the contract moves to `packages/module-note/README.md`, the
decision to PLAN §13, and this file is deleted.

## 1. What it is

Notes per workspace, run as a sub-app on the workspace's Apps page. A note is
**private to its author by default** and can be **shared with the workspace**.
The body is **Markdown**. The list updates **live**, and a save made from a stale
copy is **refused** rather than silently overwriting (optimistic concurrency).

v1 has: pin to top, search, trash with restore, tags, revisions of shared notes,
and per-person appearance settings (look, font) with a colour per note.

## 2. Decisions (from the operator, 2026-09-28)

| # | Question | Decision |
|---|---|---|
| 1 | Who sees a note | Private to the author by default; the author may share it with the workspace |
| 2 | Body | Markdown, stored as text |
| 3 | Realtime | A live list; a stale save is refused with a version check |
| 4 | Extras in v1 | Pin, search, trash/archive, tags |
| 5 | Design | Selectable **looks**: Plain, Paper, **Notebook** (default), Sticky notes, Grid |
| 6 | Colour | A colour per note, from fixed presets |
| 7 | Font | Selectable; default is a **semi-handwritten** font |

Decided while planning, after the review in §9:

| # | Question | Decision |
|---|---|---|
| 8 | Tags or folders | **Tags.** Folders need a tree, moves and cycle checks (§8) |
| 9 | Tag vocabulary | **None.** A tag is a label on a note. The filter lists only tags on notes the viewer can see, so a private note's tag never leaks. No rename/delete screen |
| 10 | Pins | **Per person.** One person's pin does not reorder everybody's list |
| 11 | Editing a shared note | Anyone holding `note:write`. Changing who sees it is the **author's** alone |
| 12 | Private means private | **No key reveals another person's private note**, `manage_all` and super-admin included |
| 13 | Limit | **Per person** (`note:notes`, counted over the author), trashed notes included |
| 14 | Delete forever | Only from the trash |
| 15 | Revisions | Kept when a **different person** edits a shared note, last 20, restorable |

## 3. Keys, limit and presets (`src/feature-keys.ts`)

All workspace level. **The bindings are the guard**: this module cannot use
`@RequireFeature`, so every operation is bound, and `surface-coverage.test.ts`
fails on one that is not.

| Key | Grants | Bound operations |
|---|---|---|
| `note:read` | open the app; read your notes and shared ones; pin; your own appearance | `Query.notes`, `Query.note`, `Query.noteRevisions`, `Mutation.setNotePinned`, `Mutation.setMyNoteSettings`, `Subscription.noteEvents` |
| `note:write` | create; edit your notes and shared ones; share/unshare your own; trash, restore, delete-forever your own; restore a revision of a note you may edit | `Mutation.createNote`, `Mutation.updateNote`, `Mutation.setNoteVisibility`, `Mutation.trashNote`, `Mutation.restoreNote`, `Mutation.deleteNoteForever`, `Mutation.restoreNoteRevision` |
| `note:manage_all` | trash, restore and delete forever **other people's shared** notes | none of its own: checked inside `write` operations through the `NoteAccessCheck` port |

- `setNotePinned` and `setMyNoteSettings` are the person's own rows and still
  **bound**, because they write a row into the workspace named in the request
  (the `setMyQueueNickname` rule): the key is what proves membership first.
- **`NoteAccessCheck`** (a port, like chat's `PlatformAdminCheck`) answers
  "does this person hold `note:manage_all` here". **Unbound means you act on
  your own notes only.** Asked per mutation that touches someone else's note,
  never on a read path.
- **Limit `note:notes`**: plan-sourced, `countedOver: 'user'`, counted by the
  module per author per workspace, **trashed notes included**, in the same
  transaction as the insert. Default 500.
- **Presets**: `note-user` (read, write) → the `workspace-user` role;
  `note-admin` (read, write, manage_all) → `workspace-admin`.
- ⚠ Existing plans are never rewritten: an operator adds `note:write` and
  `note:manage_all` on `/admin/plans`. Until then the app says why (§6).

## 4. Schema (`prisma/note.prisma`)

Every row carries `organizationId` and `workspaceId`. `userId`s are bare strings.
Presets (look, font, colour) are **text validated by the domain**, as the
queue's voice settings are: a new preset is a code change, and a value no longer
offered reads back as its default.

- **`Note`** → `note_note`: `id`, `organizationId`, `workspaceId`, `authorId`,
  `title`, `body`, `visibility` (enum `private | workspace`), `color`,
  `tags` (`String[]`, normalised), `version` (int), `trashedAt?`,
  `updatedById`, `createdAt`, `updatedAt`.
  Indexes: `(workspaceId, visibility, trashedAt, updatedAt)`,
  `(workspaceId, authorId, trashedAt)`.
- **`NotePin`** → `note_pin`: `@@id([userId, noteId])`, cascades from the note.
- **`NoteRevision`** → `note_revision`: `noteId`, `title`, `body`, `editedById`,
  `createdAt`, cascades from the note. Last 20 per note.
- **`NotePreference`** → `note_preference`: `@@id([userId, workspaceId])`,
  `organizationId`, `look`, `font`, `defaultColor`. No row means the defaults.

Tags as a `String[]` column rather than a table: there is no vocabulary to
manage (decision 9), and the filter is a `DISTINCT unnest(tags)` over notes the
viewer can see.

## 5. Server (`src/server/`)

Mirrors the queue: `note.module.ts`, `note.options.ts`, `note.tokens.ts`
(`NOTE_PRISMA`, `NOTE_WRITE_PRISMA`, `NOTE_PUBSUB`, `NOTE_ACCESS`,
`NOTE_AUTHORS`, `NOTE_LIMITS`), `ports.ts`, `note.repository.ts`,
`note.service.ts` (reads), `note-write.service.ts`, `note.errors.ts`,
`note.events.ts`, `note.pubsub.ts`, `graphql/`, `server-module.ts`.

Rules the services keep (each has a test):

- **Every lookup is `{ id, workspaceId, organizationId }`**, never `{ id }`.
  The guard checks membership of the workspace in the request, not that the
  note is in it.
- **One `NOTE_NOT_FOUND`** for a note that does not exist, is in another
  workspace, or is someone else's private note. Visibility is checked **before**
  the version, so a conflict never confirms a note exists.
- **`updateNote` takes `expectedVersion`**; a mismatch is `NOTE_CONFLICT`
  carrying the current version and who saved it.
- **A revision is written** when a shared note is saved by someone other than
  the last editor; trimmed to 20.
- **Search** escapes `%`, `_` and `\` and runs `ILIKE` over title and body,
  with visibility in the same `where`, never filtered afterwards.
- **Events carry ids and a change kind, never content**, and are filtered **per
  subscriber** (chat's way, not the queue's workspace-only filter): a private
  note's events reach its author only. Unsharing sends `removed` to everyone
  else. The client re-reads through the guarded query. A `sync` event on every
  (re)subscribe, as the queue does.

Ports: `NoteAccessCheck` (manage_all), `NoteAuthorDirectory` (names; unbound
reads "a member"), `LimitChecker` (unbound means the default cap, never
unlimited).

## 6. Web (`src/react/`)

- **`NoteApp`**: index (search, tag filter, tabs Mine · Shared · Trash, pinned
  first) and the page (title, Markdown editor with Edit/Preview, tags, colour,
  share, save status). `@container` layout: a spread of two pages when wide, one
  page at a time when narrow. Focus moves to the title when a note opens.
- **Looks**: one component each behind one `NotePage` / `NoteIndex` interface.
  Markdown, autosave and conflicts are shared; a look draws only paper and frame.
  Plain and Notebook first, then Paper, Sticky notes, Grid.
- **⚠ Everything follows the app's theme** (operator, 2026-09-28): the palette
  the app picked and its light/dark mode. Customisation TINTS the theme; it never
  replaces it.
  - **Colours**: Default, Yellow, Pink, Blue, Green, Purple, Grey. Default is the
    theme's `--card` untouched. Every other colour is the theme's `--card` with a
    small share of one hue mixed in (`color-mix(in oklch, var(--card), <hue> N%)`).
    The module owns only the hue and the share. Text stays `--card-foreground`,
    so a dark theme gives a dark yellow note, and switching palette or mode
    recolours every note with no setting touched. Not the queue's
    `display-theme.ts` pattern: the TV board deliberately has its own theme,
    and a note inside the app must not.
  - **Looks** draw their frames from tokens alone: rules `--border`, margin line
    a mix of `--destructive`, spiral and tabs `--muted`, ribbon `--primary`,
    tape `--accent`, shadows from `--foreground` at low opacity.
  - **Fonts**: Sans and Mono are the app's own font variables. The handwritten
    fonts change the typeface only, never colour or size of the app around them.
  - A pure test holds every colour × look × palette × mode to 4.5:1 text
    contrast, reading the palettes from `@kwtech/web-ui` rather than restating
    them, so a new palette is tested the day it lands.
- **Fonts**: Handwritten (Shantell Sans, default), Script (Caveat), Sans (the
  app's), Serif (Literata), Mono. The module reads CSS variables
  (`--note-font-hand`, `--note-font-script`, `--note-font-serif`) with system
  fallbacks; **the web app loads them** with `next/font`, `preload: false`. Each
  font has a size adjustment and a line height in the catalogue, so writing sits
  on the Notebook and Grid rules.
- **Markdown**: `react-markdown` + `remark-gfm` from the catalogue. No raw HTML,
  the default URL filter kept, **images rendered as links** (a remote image in a
  shared note tracks every reader). Code stays monospace.
- **Autosave**: after 2 s idle, at most one save per 5 s while typing, at once on
  blur, note switch, unmount and `visibilitychange`; a `beforeunload` warning
  while a save is pending. **One save in flight per note**; the next uses the
  version the last returned. Sends only changed fields. (The default throttle
  bucket is shared by everyone behind the Next server, §12.69.)
- **Live updates never replace text being edited.** An event for your own save
  (same version) is ignored; another person's change while you have unsaved
  text shows "Changed by …, reload?".
- **Conflict or disappearance** offers **Keep mine as a copy** (a new private
  note), as well as reload / overwrite.
- **Unsharing** asks first: others lose access, including their edits.
- **Say why**: holding `note:read` without `note:write` shows why there is no
  New button, `not_granted` or `not_entitled`.
- **Appearance popover** (toolbar): Look as thumbnails, Font as a sample word,
  default colour as dots. Applies at once, saves quietly.

## 7. Phases (one commit each)

1. `feat(module-note)`: keys, limit, presets; domain (`access`, `notes`, `tags`,
   `search`, `concurrency`, `appearance`), with tests.
2. `feat(module-note)`: the Prisma fragment; `db:migrate`, commit the migration.
3. `feat(module-note)`: the server half; service tests against a fake client,
   surface coverage.
4. `feat(web-server)`: adapters, providers, seed grants and plans; `db:sync`;
   boot the API.
5. `feat(module-note)` + `feat(web-app)`: the app with Plain and Notebook, fonts
   loaded by the web app.
6. `feat(module-note)`: live updates.
7. `feat(module-note)`: Paper, Sticky notes, Grid.
8. `docs` + `test(web-app)`: README, PLAN §13 entry, §12 items.

## 8. Not in v1 (→ PLAN §12 when built)

Folders; full-text search (`tsvector` / `pg_trgm`); collaborative editing;
attachments and inline images; emptying the trash automatically; deleting a
former member's private notes (needs a membership port and a policy); an
admin-enforced look; custom colours; per-note look or font; font size;
notifications when a shared note changes; a full-page route for deep links.

## 9. Review (2026-09-28): the holes this plan closes

Security: a note id from another workspace (§5 lookups); errors that confirm a
private note exists (one `NOTE_NOT_FOUND`); tag names leaking private notes
(decision 9); live events reaching the wrong people (per-subscriber filter);
tracking images (images as links).

Data loss: autosave conflicting with itself (one save in flight); your own event
overwriting your typing; conflicts offering only overwrite or discard (keep a
copy); a note vanishing mid-edit (keep a copy); the last second lost on close
(flush on blur, unmount, hide).

Gaps: autosave exhausting the shared throttle bucket; blanking a shared note with
no history (revisions); private notes filling a workspace's quota (per-person
limit); endless trash (counts toward the limit); an empty app with no reason
(say why); unshared notes vanishing silently (confirm, `removed` event).
