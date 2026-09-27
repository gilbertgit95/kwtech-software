# @kwtech/module-note

Notes per workspace, run as a **sub-app** on the workspace's Apps page
(`module-app-hub`). A note is **private to its author** until they **share it
with the workspace**; the body is **Markdown**; the index updates **live**; and a
save made from a stale copy is **refused**, never silently overwriting.

Everyone chooses their own **look** (Notebook by default, Plain, Paper, Sticky
notes, Grid) and **font** (a semi-handwritten one by default), and each note has
a **colour**. All three TINT the app's theme; none replaces it.

The plan and the review behind it: `docs/NOTE-PLAN.md`. The decision: PLAN §13,
2026-09-28.

## In a Next.js app

```ts
// apps/web-app/src/modules.ts
import { noteWebModule } from '@kwtech/module-note/react';
const FEATURE_MODULES = [..., noteWebModule()];
```

It contributes one sub-app (key `note`, "Notes", icon `pen`, order 20), no
routes and nothing in the drawer.

### Fonts — the app loads them

The module reads three CSS variables and cannot load a font itself (its React
half may not depend on Next). Define them, or the fallbacks show:

| Variable | Face | Option |
|---|---|---|
| `--note-font-hand` | Shantell Sans | Handwritten (the default) |
| `--note-font-script` | Caveat | Script |
| `--note-font-serif` | Literata | Serif |

Sans and Mono are the app's own `--font-sans` / `--font-mono`. This app sets them
in `apps/web-app/src/app/layout.tsx` with `next/font`, **`preload: false`**, so
only a page that uses a face downloads it.

## In a NestJS app

```ts
noteServerModule({
  prismaProvider: notePrismaProvider,
  prismaWriteProvider: noteWritePrismaProvider,
  limitCheckerProvider: { provide: NOTE_LIMIT_CHECKER, useExisting: PermissionsLimitChecker },
  accessCheckProvider: { provide: NOTE_ACCESS_CHECK, useFactory: … },
  authorDirectoryProvider: { provide: NOTE_AUTHOR_DIRECTORY, useFactory: … },
  resolveActorId: (request) => resolvePrincipal(request)?.userId,
  pubsubProvider: { provide: NOTE_PUBSUB, useValue: realtimePubSub() },
});
```

and compose the registry — **the bindings are the guard**:

```ts
// apps/web-server/src/seed/registry.ts
{ key: 'note', features: NOTE_FEATURE_REGISTRY, limits: NOTE_LIMIT_REGISTRY },
```

| Port | Asked | Unbound means |
|---|---|---|
| `NOTE_LIMIT_CHECKER` (`LimitChecker`) | creating a note | the **declared default** (500) — never unlimited |
| `NOTE_ACCESS_CHECK` (`NoteAccessCheck.holdsManageAll`) | only to bin somebody ELSE's SHARED note | **no**: you act on your own notes only |
| `NOTE_AUTHOR_DIRECTORY` (`NoteAuthorDirectory.describe`) | rendering names | no names; the app says "a member" |
| `NOTE_PUBSUB` | after every committed change | **not live**; the app shows "Not live" |

This app's adapters: `apps/web-server/src/note/`.

## Realtime

One trigger, `note.changed`. `noteEvents(organizationId, workspaceId)` sends
`sync` first on every (re)subscribe, then `changed` / `removed` with a note id,
its version and who acted.

- **Filtered per subscriber** (`noteEventFor`), not per workspace: a private
  note's events reach its author and nobody else. Unsharing sends `removed` to
  everyone who just lost the note.
- **Ids and versions, never content.** The app reads the note again through
  the guarded query.
- The app never replaces unsaved text on an event: it asks (see "Saving").

## Vocabulary

| | |
|---|---|
| **Private / shared** | `visibility`: `private` (the author only, whatever keys anyone holds) or `workspace` |
| **Revision** | the text a save REPLACED, kept when somebody other than the last editor saves a shared note (last 20). Restoring one always keeps the text it replaces |
| **Trash** | `trashedAt`. Read-only until restored. Delete forever only from here |
| **Pin** | per person — nobody else's order moves |
| **Tag** | a label on one note. There is no shared tag list: it would show private notes' tags to everybody |
| **Preview** | the start of the body as plain text, stored with every save. The index reads it, never the body |

## The domain entry point

`@kwtech/module-note` is framework-free:

- `access.ts` — `canSeeNote`, `checkEditNote`, `checkShareNote`, `checkPinNote`,
  `planNoteBinAct` (→ `allowed` / `needs_manage_all` / `refused`),
  `shouldKeepRevision`. ⚠ Somebody else's private note is `not_found` from every
  check, before any other reason.
- `notes.ts` — title and body rules, `notePreview`, `noteDisplayTitle`,
  `checkNoteVersion`, and the two messages the app matches:
  `NOTE_NOT_FOUND_MESSAGE`, `NOTE_CONFLICT_MESSAGE` (production strips error
  reasons, so the app compares messages).
- `tags.ts`, `search.ts` (⚠ `escapeLikePattern` — Prisma's `contains` does not
  escape `%` or `_`), `events.ts`, `appearance.ts` (the presets, stored as text).
- `NOTE_OPERATIONS` — every document the app sends.

## Keys, the cap, presets

| Key | Grants |
|---|---|
| `note:read` | open the app; read your notes and shared ones; pin; your appearance |
| `note:write` | create; edit your notes and shared ones; share your own; bin, restore, delete forever your own; restore a revision |
| `note:manage_all` (privileged) | bin, restore and delete forever OTHER people's SHARED notes. No binding of its own — checked through `NoteAccessCheck` |

There is **no key that reads another person's private note**.

`note:notes` — notes one person may keep in a workspace, **trash included**,
plan-sourced, counted per person (default 500). Per person because nobody can
clear somebody else's private notes.

Presets (data, never seeded here): `note-user` (read, write) and `note-admin`
(read, write, manage_all). This app grants them to `workspace-user` and
`workspace-admin`.

## Saving

- **Autosave** 2 s after the last keystroke, and at least every 5 s while
  typing (`autosaveDelay`) — the throttle bucket is shared by everyone behind
  the Next server (PLAN §12.69). Also on blur, before switching notes, when the
  tab hides, and on unmount; a warning before the page closes with a save
  pending.
- **One save in flight**; an edit during it is saved after, from the version it
  returned. Only changed fields are sent, compared as the server normalises
  them.
- **Every write is a compare-and-set** on `version`. A stale save is refused.
- A **conflict** or a **vanished note** offers **Keep mine as a copy** (a new
  private note) beside use-theirs / overwrite / discard.

## Appearance

Tints, never colours (`src/react/view/appearance.ts`): a page is
`oklch(from var(--card) …)` with the card's lightness kept and one hue added;
text stays `--card-foreground`; lines and frames are the theme's own tokens.
`test/appearance-contrast.test.ts` reads every palette in
`@kwtech/web-ui/themes/*.css` and holds every colour to 4.5:1, light and dark.

Every line of text is one **rule** (`NOTE_RULE_REM`) and every gap a whole number
of them, so writing sits on the Notebook's lines; the lines are painted on the
element that scrolls.

## Markdown

`react-markdown` + `remark-gfm`, loaded only when a note is previewed. **No raw
HTML. Images are shown as links**, never loaded: a remote image in a shared note
would report every reader to whoever wrote its URL. Task-list boxes are shown,
not tickable.

## What it declares

| | |
|---|---|
| Models | `Note`, `NotePin`, `NoteRevision`, `NotePreference` → `note_*` |
| Operations | `notes`, `note`, `noteRevisions`, `myNoteSettings`, `noteEvents`; `createNote`, `updateNote`, `restoreNoteRevision`, `setNoteVisibility`, `trashNote`, `restoreNote`, `deleteNoteForever`, `setNotePinned`, `setMyNoteSettings` |
| Sub-app | `note` — ⚠ saved in people's layouts; never rename it |

## Entry points

| Import | Contents |
|---|---|
| `@kwtech/module-note` | domain, keys, operations. No framework |
| `@kwtech/module-note/server` | `noteServerModule`, services, resolver, ports, tokens |
| `@kwtech/module-note/react` | `noteWebModule()`, `NoteApp` |
| `@kwtech/module-note/prisma` | the schema fragment |
