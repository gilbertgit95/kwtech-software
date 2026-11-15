# @kwtech/module-file-manager

The **Files** sub-app (issue #138): a member uploads any file, shares it
privately, with the workspace, or with chosen people, and whoever it is shared
with downloads it. Files are **temporary**: every night at 10 PM, in the
workspace's own time, the clean-up deletes the files older than the workspace
keeps them (24 hours unless changed).

Today the bytes are in a folder on the API's disk. When a blob server exists,
the app binds another `FileStore` and nothing else changes (PLAN §13,
2026-11-15).

## In a Next.js app

```ts
// apps/web-app/src/modules.ts
import { fileWebModule } from '@kwtech/module-file-manager/react';
export const WEB_MODULES = [/* … */ fileWebModule()];

// apps/web-app/src/mobile-modules.ts
import { fileMobileModule } from '@kwtech/module-file-manager/mobile';
```

A file is not JSON, so the bytes have two route handlers of their own, passed
on as streams. **No session is read there:** the one-time ticket the guarded
mutation gave is the authorisation.

```ts
// app/api/files/upload/route.ts
export const { PUT } = createFileUploadRouteHandlers();   // '@kwtech/module-file-manager/next'
// app/api/files/download/route.ts
export const { GET } = createFileDownloadRouteHandlers();
```

⚠ **Keep the proxy (`src/proxy.ts`) off `/api/files`.** Next reads a request's
body to run a proxy over it, up to a size limit, and a larger file arrives cut
short.

Both handlers read `API_URL` (or `apiUrl`), and answer 503 without it.

## In a NestJS app

```ts
fileServerModule({
  prismaProvider: filePrismaProvider,
  prismaWriteProvider: fileWritePrismaProvider,
  storeProvider: { provide: FILE_STORE, useFactory: () => createFolderFileStore(env.FILES_DIR) },
  limitCheckerProvider: { provide: FILE_LIMIT_CHECKER, useExisting: PermissionsLimitChecker },
  memberDirectoryProvider: { provide: FILE_MEMBER_DIRECTORY, /* … */ },
  notifierProvider: { provide: FILE_NOTIFIER, /* … */ },
  pubsubProvider: { provide: FILE_PUBSUB, useValue: realtimePubSub() },
  resolveActorId: (request) => resolvePrincipal(request)?.userId,
});
```

| Option | Unbound means |
|---|---|
| `storeProvider` (`FileStore`) | **Files are off.** The list still reads; every upload and download is refused "not set up" |
| `limitCheckerProvider` | The **declared default** caps (25 MB a file, 500 MB in all), never unlimited |
| `memberDirectoryProvider` (`FileMemberDirectory`) | Nobody can be chosen by name (a file is private or the workspace's), and nobody has a name |
| `notifierProvider` (`FileNotifier`) | Nobody is told a file was shared with them; sharing still works |
| `pubsubProvider` | **Not live**: lists change when read again |
| `uploadTicketSeconds` / `downloadTicketSeconds` | 300 / 60 |
| `expose` | `{ graphql: true, rest: true }`. `rest` is the two byte routes |

`createFolderFileStore(root)` is the store the app uses today:
`<root>/<workspaceId>/<storageKey>`, where the key is 32 random hex characters.
**No name from a person is ever part of a path**, and every path is checked to
stay inside `root`. An upload is written as `<key>.part` and renamed once the
last byte arrives.

The app binds `FILES_DIR` (default the repository's gitignored
`uploaded-files/`). In production, set it to an absolute path outside the
deployed code.

## Realtime

One trigger, `file.changed`. Each event carries the file's audience before and
after the change, as user ids, and **no name and no size**. Every subscriber
runs `fileEventReaches`, which applies the same `canSeeFile` as every read, so
a private file's events reach its owner alone. A person who just LOST a file
(it was made private, or deleted) is told too, so their list drops it. A
settings change and a clean-up reach everybody in the workspace. The client
reads its list again for each event.

## Vocabulary

| Term | Meaning |
|---|---|
| **Visibility** | `private` (the owner alone, whatever keys anyone holds), `workspace` (everybody holding `file:read`), `people` (the people chosen, who must hold `file:read`, at most 50) |
| **Owner** | Who uploaded it: the only person who may re-share or delete it |
| **Retention** | How old a file must be before the clean-up deletes it, in hours: 24 by default, 1 to 168, per workspace (`FileSettings`) |
| **Clean-up** | The `file.cleanup` process at 10 PM in the workspace's zone |
| **Ticket** | 256 random bits, one-time, kept as its SHA-256 in `file_ticket` so any API server spends it: 5 minutes to start an upload, 1 to start a download; at most 100 live per person |
| **Stray** | Bytes in the store with no row: an upload that died, or a delete whose bytes could not be removed |

## The domain entry point

`@kwtech/module-file-manager` is pure (no framework, no Node built-ins):
`canSeeFile`, `canChangeFile`, `prepareFileSharing`, `prepareFileName`,
`newlySharedWith`, `fileDeletionAt`, `fileCleanupMoment`, `fileCleanupCutoff`,
`fileContentDisposition`, `fileRefusalMessage`, `formatFileSize`, plus the
registries and `FILE_OPERATIONS`.

## When a file is deleted

**One moment deletes it: the nightly clean-up.** It deletes every file uploaded
MORE than `retentionHours` before that night's 10 PM. Until then a file stays
listed and downloadable, even past its age. A file uploaded at 9 PM on Monday
is an hour old at Monday's clean-up and is kept, then deleted at 10 PM on
Tuesday. The page shows each file's "Deleted at 10 PM on Tue, 17 Nov"
(`fileDeletionAt`, in the workspace's zone).

⚠ The page shows the DECLARED 10 PM. An admin who moves or pauses the clean-up
on the Background jobs page changes when files go, not what the page says
(PLAN §12.137).

## Uploading and downloading

1. `startFileUpload` checks everything it can before a byte is sent: the name,
   the size against the caps, and who it will be shared with. It hands out a
   ticket.
2. The browser `PUT`s the bytes to `/api/files/upload` with the ticket in
   `x-file-upload-ticket` (XMLHttpRequest, for progress). The ticket is spent
   before the first byte is read. The store stops at the first byte past the
   declared size. Once the last byte arrives, the room is counted **again**
   in the transaction that inserts the row, because other uploads may have
   filled it meanwhile. Any refusal discards the bytes.
3. `issueFileDownload` checks the file is one you can see and hands out a
   ticket. The page clicks a link to `/api/files/download?ticket=…`, which
   streams the file **always as an attachment**, as
   `application/octet-stream` with `nosniff`. It is never served with the
   type the uploader declared, because an HTML file served as HTML would run
   in the app's origin.

### On several API servers

The tickets are rows, so the mutation and the byte route may land on different
servers. Spending is one conditional delete: two requests racing for one
ticket, on one server or two, cannot both win. ⚠ **The bytes are the store's**,
so every server must reach the same one: one shared folder mounted at
`FILES_DIR` on each, or the blob server when it exists.

Refusals on the byte routes are JSON `{ reason, message }`: 404 for a ticket
unknown, spent or expired (one answer for all three), 400 for a size mismatch,
413 for a cap, 429 for somebody holding 100 live tickets (`too_many_transfers`), 503 when no store is bound.

⚠ A download is checked AGAIN when its ticket is spent: a file made private, or unshared from that person, in the minute since is not handed over.

## Processes

**`file.cleanup` — File clean-up.** Every night at 10 PM in each workspace's
own time, it deletes the files older than the workspace keeps them, the
strays at least an hour old, and the workspace's expired tickets. The row goes first, then the bytes: a failure
between them leaves a stray, never a row whose download is broken.

- **Schedule:** daily at 22:00, every day. An admin may change it to other
  daily times or an interval of at least 15 minutes. Daily sweeps run every 15
  minutes, so a workspace's 10 PM is reached within 15 minutes of it.
- **Idempotent by what it deletes.** The cutoff is measured from the
  SCHEDULED 10 PM, not the run's clock (`fileCleanupMoment`), so every sweep of
  one night (on time, late, or twice) deletes the same files. There is no
  notice to send once, so there is no claim row.
- **Late is still done.** It runs until the workspace's midnight
  (`tooLateAfterMinutes: 120`). A clean-up is never worse for being late, and
  nothing is counted as skipped.
- **Limits:** at most 5,000 files a run (the rest still match the next sweep),
  300 seconds a run.
- **Reaches only workspaces whose plan includes Files** (JOBS-PLAN D12). A
  workspace that loses Files is not cleaned up until it gets them back
  (PLAN §12.138).
- **Paused:** files are not deleted, and the page still says "Deleted at
  10 PM on …" (PLAN §12.137).

## What it declares

| Key | Level | Lets you | Bound to |
|---|---|---|---|
| `file:read` | workspace | open the app; list and download the files you can see; see the settings | `files`, `fileSettings`, `issueFileDownload`, `fileEvents` |
| `file:write` | workspace | upload; share and delete your own; read who you can share with | `startFileUpload`, `setFileSharing`, `deleteFile`, `fileShareableMembers` |
| `file:manage` | workspace | choose how long the workspace keeps files | `setFileSettings` |

**No key opens somebody else's private file**, and none deletes somebody
else's file. Every file goes tonight anyway.

| Cap | Source | Counted over | Default |
|---|---|---|---|
| `file:file_size_mb` (the largest one file, in MB, held at most 2047) | plan | workspace | 25 |
| `file:storage_mb` (all the workspace's files together, in MB) | plan | workspace | 500 |

The caps are SIZES. The module asks the `LimitChecker` for the cap only and
compares bytes itself. A refusal is worded by `limitReachedText`, so it names
the plan that raises the cap.

Presets: `file-user` (`read`, `write`) and `file-admin` (all three). The app's
Staff and Supervisor roles hold `file-user`, and Admin holds `file-admin`.
Every paid plan sells Files.

The byte routes `PUT /files/upload` and `GET /files/download` are
**public surfaces with a reason** (the ticket is the authorisation), and
never credential surfaces. `surface-coverage.test.ts` checks both.

Notification source: `file.shared` (mutable).
