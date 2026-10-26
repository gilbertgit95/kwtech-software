# @kwtech/module-backup

**Database backups** (issue #2): a super admin's **Database → Backups** page
(back up now, download, delete, restore), a **daily backup at 9 PM**, and the
same from the **command line**.

**Nothing about a backup is in the database** (the operator, 2026-10-26). The
page lists the backup FOLDER; everything it shows is in each file's name; who
did what is the **API log** (`[Backup]`, one structured line per act). What is
running, maintenance and download tickets are in the server's memory. The
only database rows are `module-jobs`' own record that the daily process ran,
as counts, never a file name.

## In a Next.js app

```ts
// apps/web-app/src/modules.ts
backupWebModule(),

// apps/web-app/src/app/api/backups/download/route.ts
export const { GET } = createBackupDownloadRouteHandlers();
```

One page, `/admin/database/backups`, in its own **Database** drawer section
(order 60, after Administration), behind `backup:read`. It is the first page
of that section; other database tasks join it. Keep the app's proxy off
`/api/backups`.

| Option | Default | Meaning |
|---|---|---|
| `processesHref` | `/admin/processes` | where the page sends people to change or pause the daily backup |

## In a NestJS app

```ts
backupServerModule({
  resolveActorId: (request) => resolvePrincipal(request)?.userId,
  timeZone: env.BACKUP_TIME_ZONE ?? DEFAULT_TIME_ZONE,
  keep: env.BACKUP_KEEP,
  storeProvider: { provide: BACKUP_STORE, useFactory: () => createBackupStore(env) },
  passwordCheckProvider: { provide: BACKUP_PASSWORD_CHECK, … },   // module-auth's confirmPassword
  endSessionsProvider: { provide: BACKUP_END_SESSIONS, … },       // module-auth's endEverySession
}),

// and FIRST among the app's global guards:
{ provide: APP_GUARD, useExisting: BackupMaintenanceGuard },
```

Then `seed/registry.ts`: `{ key: 'backup', features: BACKUP_FEATURE_REGISTRY,
processes: BACKUP_PROCESS_REGISTRY }`, and `db:sync`.

| Option | Default | Meaning |
|---|---|---|
| `timeZone` | Asia/Manila | the zone of file names and of the daily 21:00. Never UTC |
| `keep` | 30 | how many backups the folder keeps; the 31st deletes the oldest |
| `downloadTicketSeconds` | 60 | how long a download link works |

| Port | Unbound means |
|---|---|
| `BACKUP_STORE` | the page lists nothing, every act is refused "Backups are not set up on this server" |
| `BACKUP_PASSWORD_CHECK` | no restore, ever |
| `BACKUP_END_SESSIONS` | no restore, ever: a restored database would bring back sessions somebody had ended |

The app's store (`apps/web-server/src/backup/pg-backup-store.ts`) writes to
`BACKUP_DIR`, running `pg_dump` / `pg_restore` inside `BACKUP_DOCKER_CONTAINER`
when set (the local dev database) or from the PATH against `DATABASE_URL`.

## Backup files

```
kwtech-2026-10-26-210003-daily.dump
└db──┘ └day─────┘ └time┘ └kind┘      kind: manual | daily | before-restore
```

Postgres's custom format (`pg_dump -Fc`), written under `.partial` until
pg_dump succeeds, `0600`. The day and time are in the backup zone. **Only names
of this shape are listed, downloaded, deleted, restored or counted**; anything
else in the folder is left alone, and a name from the browser is never joined
to a path as given.

**The limit:** after every successful backup, the oldest past `keep` (30) are
deleted, whatever their kind, and each deletion is logged. During a restore
the file being restored from is never deleted.

## The page

Each control checks its own key, and the API checks again:

| Key | What it allows |
|---|---|
| `backup:read` | the list, and whether a backup or restore is running |
| `backup:create` | Back up now |
| `backup:download` (privileged) | a one-time link, valid a minute, to download a file |
| `backup:delete` (privileged) | delete a file |
| `backup:restore` (privileged) | replace the database with a file |

All are app level and granted to nobody by this module: `super-admin` holds
every registered key, so after `db:sync` only super admins have them.

**Downloads** copy module-print's relay: `issueBackupDownload` (guarded)
returns a ticket; the browser goes to `/api/backups/download?ticket=…`; the
web app passes it to the API's public `GET /backups/download`, which spends it
and streams the file. A file is not a GraphQL value.

**Restore**, in this order, each step a reason to stop before the next:

1. the name, the database's name typed exactly, and the caller's password
   (a credential surface: the tight throttle);
2. a **safety backup** of the database as it is (`before-restore`); if it
   fails, nothing else happens;
3. **maintenance**: `BackupMaintenanceGuard` answers every other request 503,
   which the web app shows as "cannot reach the server" and waits;
4. `pg_restore --clean --if-exists --no-owner --single-transaction` (a failure
   leaves the database as it was), then `prisma migrate deploy`, so an older
   backup's schema is brought up to this version;
5. **everybody signed out** (module-auth's `endEverySession`), the restorer
   included; the page goes to sign-in.

One backup or restore at a time, per server process: a second is refused, not
queued.

## Processes

| Key | What it does | Default | Limits |
|---|---|---|---|
| `backup.daily` | makes the evening's backup, then applies the limit | daily 21:00, every day, in the backup zone | daily only; swept every 15 minutes; 300 s a run; 1 backup a run; 3 hours late at most |

"Done today" is the folder: a `daily` file named for the backup zone's day. A
second run that day makes nothing. If a backup or restore is running, it is
left for the next sweep. Paused on the Processes page, no daily backups are
made and the page still says "every day at 9:00 PM" — the Processes page is
where its state is.

## The command line

On the server, with the same store, names, limit and safety backup:

```bash
pnpm --filter @kwtech/web-server backup:create        # pnpm db:backup on a dev machine, which also opens the folder
pnpm --filter @kwtech/web-server backup:list
pnpm --filter @kwtech/web-server backup:restore <file> [--yes]
```

⚠ **Stop the API before a command-line restore.** Nothing holds requests off
there. It asks for the database's name typed out unless `--yes`, takes no
password (the shell login is the proof), and ends every session in the
restored database.

## What it declares

Five app-level keys (above), one process (`backup.daily`), no Prisma
fragment, one public HTTP route (`GET /backups/download`, ticket-admitted),
and the `/next` download handler.
