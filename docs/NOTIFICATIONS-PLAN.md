# `module-notification` — plan

Status: **phases 1, 1b and 2 built, 2026-09-25**, with the per-device half of
phase 3. Phase 3's per-person source mutes and phase 4 (announcements) are not
built yet. When they ship, what was decided here moves into the module README
and PLAN §13, and this file is deleted.

## Built, and where it differs from this plan

| Area | State |
|---|---|
| Phase 1 — inbox, bell, toasts, pages, pagination, bulk, tab title, flood rule, realtime delivery | built |
| Phase 1b — grouping, recall, system pop-ups | built |
| Phase 2 — admin compose and Sent | built |
| Phase 3 — device settings (toasts, sound, pop-ups) | built |
| Phase 3 — per-person source mutes (`NotificationPreference`) | **not built** — `mutable` is declared on sources but nothing reads it yet |
| Phase 4 — announcements | **not built** |

Where the build differs from the text below:
- **The two limits are module OPTIONS, not registry limits** (`maxRecipientsPerSend`,
  `floodLimitPerMinute`). module-kit's limit checker resolves a cap for an acting
  person, and nearly every send has none.
- **No tone extraction was needed.** The tone engine had already moved to
  `@kwtech/web-ui` for the queue board's chime; this module brings its own
  catalogue.
- **Recall is `notification:manage` only.** "Your own batches with
  `notification:send`" is not implemented; both keys are super-admin only today,
  so nothing is lost yet.
- **The compose screen has no context field and no grouping.** A platform
  message is global; grouping is refused there on purpose (recall, §6).
- **The source filter and the "where from" filter** are both on the page; the
  second lists organizations seen in loaded rows.

## 1. What it is

A whole feature, vertically, shaped like `module-chat`:

- **System notifications.** The system talks to a person: queue events,
  platform notices, account and security events, announcements. **People do not
  message each other here; that is what chat is for.** Nearly every sender is
  server code. The one human-driven path, the super-admin compose page, also
  sends *as the system* (§5a).
- **A notification is addressed to one person** and has a severity, a title, a
  body, a source ("Queue", "Platform"), and optionally a context (which
  organization or workspace it came from) and up to three link or download
  buttons.
- **Global.** The inbox belongs to the person, not to a tenant. One list and one
  unread count cover every organization and workspace. The context is a label
  on the item. It never filters access, and it stays visible after the person
  leaves that organization.
- **A header tool** (a bell), placed right of chat's inbox when chat is on, with the live unread
  count. Its panel shows unread items first, and "View all" goes to
  `/notifications`, which is paginated.
- **Realtime.** A new notification reaches every open tab, bumps the badge,
  shows a **toast** for a few seconds, and updates the tab title. When every tab
  is in the background, the browser can also show a system pop-up.
- **Announcements**: a message to everyone (or to one organization) that shows
  in every inbox, including people who sign up while it is live, and can show as
  a banner.
- **Nothing is deleted.** Everything is kept. Archive and recall hide items;
  pagination is what keeps a long history usable.

**Independent of chat.** The two modules are peers at the same level: neither
imports the other, neither needs the other installed, and the app never routes
an answer from one into the other (§1a).

What it is **not**: person-to-person messages (chat), server-side action buttons
such as "Accept invitation", scheduled sending, snooze, rich-text bodies, or
notifications for chat messages (see §15).

## 1a. Independence from chat

`module-chat` and `module-notification` sit at the same level. Each is a whole
feature, and each works with the other disabled (`enabled: false`) or not
installed at all. Concretely:

| Where they could touch | What this plan does |
|---|---|
| Imports | None, either way (§9 rule 5 already forbids it) |
| Knowing whether someone is online | Not tracked at all. Nothing in this module needs it (§10) |
| `dnd` | Chat's availability. This module doesn't read it (decision 1) |
| The header | Two separate header tools, ordered by number (chat 10, notifications 20). Either renders alone; neither knows the other exists |
| Toast position (top centre) | Clear of chat's window in the bottom-right. It is a layout choice, not a dependency: the toasts are in the same place with chat off |
| "Full page open, stay quiet" | Its own `useNotificationsPageOnScreen`, modelled on chat's hook, not imported from it |
| Chat messages | Never become notifications. Chat has its own badge, tone and email |
| Sound (phase 3) | The synthesised tones move from `module-chat` into `@kwtech/web-ui` (§13). Afterwards **both** modules depend on `web-ui` and neither on the other. That is what keeps them independent: the alternative is a second copy of the tone code |

A test in the web-server suite boots the app with each module disabled in turn
and checks the other still serves its operations, so this stays true as both
grow.

## 2. Package layout

```
packages/module-notification/
  prisma/notification.prisma          models, see §3, §5a, §9, §11
  src/index.ts                        pure core: types, keys, operations
  src/feature-keys.ts                 NOTIFICATION_FEATURE(_REGISTRY), NOTIFICATION_LIMIT_REGISTRY,
                                      NOTIFICATION_ROLE_PRESETS
  src/operations.ts                   GraphQL documents the client sends
  src/types.ts                        Severity, NotificationAction, NotificationContext, wire shapes
  src/domain/
    actions.ts                        parse + validate link/download actions, safe hrefs
    context.ts                        NotificationContext <-> the two columns (§3a)
    compose.ts                        validate a send (lengths, recipients, dedupe, sources)
    ordering.ts                       unread-first order and its cursor (§7)
    grouping.ts                       fold into an unread group, the group title (§6)
    flood.ts                          the per-source rate rule and its overflow group (§12)
    unread.ts                         badge text (0, 1..99, "99+"), tab-title prefix
    toast.ts                          how long a toast stays, what shows one
    browser-notify.ts                 when a system pop-up is shown (§8)
    live-state.ts                     connection state thresholds for the bell (§10)
    preferences.ts                    muted sources, what muting suppresses (§11)
    announcements.ts                  is an announcement live, and for whom (§9)
  src/server/
    notification.module.ts / server-module.ts   notificationServerModule({...})
    notification.tokens.ts            the DI tokens for every port in §14
    notification.repository.ts
    notification.service.ts           list, count, read/unread, archive, recall
    notification.sender.ts            NotificationSender: how the app sends one
    announcement.service.ts
    notification.pubsub.ts            NOTIFICATION_EVENT + structural PubSub port
    graphql/notification.resolver.ts + announcement.resolver.ts + *.types.ts
  src/react/
    module.tsx                        notificationWebModule({ enabled })
    notification-client.ts / use-notifications.ts   one hook: list, count, socket, catch-up
    notification-settings.ts          per-device settings in localStorage (§11)
    use-tab-title.ts                  "(3) kwtech"
    use-browser-notifications.ts      the system pop-up, one tab only
    components/notification-header-tool.tsx         bell, badge, panel
    components/toast-stack.tsx                      the toasts, portalled to <body>
    components/announcement-banner.tsx
    components/notification-item.tsx                shared by panel and page
    components/pager.tsx                            page size, prev/next, "41–60 of 1,284"
    pages/notifications-page.tsx                     /notifications
    pages/notification-preferences-page.tsx          /notifications/preferences
    pages/admin-compose-page.tsx                     /admin/notifications (send + sent + recall)
  test/ fake-client.ts, *.test.ts
```

Names: models are `Notification*`, tables `notification_*`, feature keys
`notification:*`, and events `notification.*`.

## 3. Schema: the inbox

```prisma
enum NotificationSeverity { info success warning alert }

model NotificationItem {
  id             String   @id @default(cuid())
  recipientId    String                         // bare userId, no FK (§9 rule 10)
  severity       NotificationSeverity @default(info)
  title          String   @db.VarChar(160)
  body           String?  @db.VarChar(2000)      // plain text, never HTML
  source         String   @db.VarChar(64)        // a DECLARED source key (§11): 'queue.session', 'platform'
  organizationId String?                        // null = global (platform-wide). See §3a
  workspaceId    String?                        // set only together with organizationId
  contextLabel   String?  @db.VarChar(160)       // "Acme · Front desk", snapshotted at send; null when global
  actions        Json     @default("[]")         // links and downloads, validated by domain/actions.ts
  dedupeKey      String?                        // a producer re-sending does not duplicate
  batchId        String                         // one per send() call (§5a)

  // grouping (§6)
  groupKey       String?  @db.VarChar(128)
  groupCount     Int      @default(1)

  createdAt      DateTime @default(now())
  occurredAt     DateTime @default(now())        // = createdAt, bumped when a group folds in. The list orders by this
  readAt         DateTime?
  archivedAt     DateTime?
  recalledAt     DateTime?                      // recalled rows are never returned (§5a)
  expiresAt      DateTime?                      // after this the buttons are hidden and the item says so

  @@unique([recipientId, dedupeKey])
  @@index([recipientId, archivedAt, readAt, occurredAt, id])  // the list, unread-first keyset (§7)
  @@index([recipientId, organizationId, occurredAt])           // the "from this organization" filter
  @@index([recipientId, groupKey, readAt])                     // find the open group to fold into (§6)
  @@index([recipientId, source, createdAt])                    // the flood rule (§12)
  @@index([batchId])                                           // recall
  @@map("notification_item")
}
```

- **One row per recipient.** Read state is per person, and a send to 500 people
  is 500 rows written in one `createMany`. Sends to *everyone* do not work this
  way: they are announcements (§9), which keeps this table from being written
  once per user per broadcast.
- **No sender on the item.** Every item comes from the system, and what the
  person sees is its **source label** ("Queue", "Platform"). Who pressed send on
  the compose page is recorded on the batch for audit (§5a) and never shown to
  recipients.
- **Context is a snapshotted label, not a lookup.** The module cannot resolve
  organization names (it cannot import permissions), and history should say what
  the place was called when the notification was sent.
- **Actions as validated JSON, not a table.** There are at most three per item,
  they are never queried, and they are written once. `domain/actions.ts` is the
  one parser, used by the sender and by every read, so a bad row renders with no
  buttons instead of crashing the list.
- **Nothing is deleted (decision 2).** Archive hides an item from the default
  view; recall hides it everywhere. Every index leads with `recipientId`, so the
  cost of a long history is one person's own rows, not the table's. The growth
  is recorded as a PLAN §12 entry when this ships, so it's a known cost rather
  than a surprise; the day it matters, the answer is partitioning or an
  archive table, not deletion.

## 3a. Where a notification came from: global, organization or workspace

`organizationId` and `workspaceId` are both **optional**. Leaving both empty is
the normal case for a **global** notification (a platform announcement, a
security notice about your own account). There are three valid shapes, and
exactly three:

| Shape | `organizationId` | `workspaceId` | Example |
|---|---|---|---|
| global | null | null | "Scheduled maintenance tonight" |
| organization | set | null | "Acme's plan was upgraded" |
| workspace | set | set | "Front desk: the queue session was closed" |

- **A workspace without its organization is refused.** The domain type makes
  it unrepresentable, and the Prisma type cannot:
  ```ts
  type NotificationContext =
    | { scope: 'global' }
    | { scope: 'organization'; organizationId: string; label?: string }
    | { scope: 'workspace'; organizationId: string; workspaceId: string; label?: string };
  ```
  The sender takes `context?: NotificationContext` (omitted means `global`).
  `domain/context.ts` maps it to the two columns and back. A row with a
  workspace and no organization is dropped on read and logged, rather than
  rendered as something it isn't.
- **The IDs are bare strings with no foreign key**, like `recipientId`. The
  module does not own organizations and cannot import the module that does. If
  an organization is deleted, its notifications keep their label and lose
  nothing else.
- **They describe where a notification came from. They do not control who sees
  it (decision 4).** Only `recipientId` decides that. Someone who has left Acme
  still sees what Acme sent them, and its links check access again when opened.
- **GraphQL** exposes `organizationId`, `workspaceId` and `contextLabel`, all
  nullable, on `Notification`. `Query.notifications` gets an optional
  `organizationId` filter and a `globalOnly` flag, so the page can show "All ·
  Global · Acme · …".
- **UI**: a global item has no chip, or a neutral "Platform" chip. An
  organization or workspace item shows `contextLabel`. When the notification has
  no link, the chip links to that organization or workspace home. That page
  checks access again on open, so for someone who has left, the chip leads to a
  refusal that says why rather than to the old workspace.

## 4. Severities

`info`, `success`, `warning`, `alert`, as a closed enum. Each maps to a
`@kwtech/web-ui` tone token (check `tones.ts`) and an icon, never to a raw
colour. "And so on" belongs in `source`, which says what a notification is
about, not in severity, which says how loud it is. A new severity is a schema
change on purpose.

| Severity | Toast stays | Live region | Missed while offline (§10) |
|---|---|---|---|
| `success`, `info` | 2 s | `polite` | counted in one summary toast |
| `warning` | 3 s | `polite` | counted in one summary toast |
| `alert` | 3 s | `assertive` (`role="alert"`) | its own toast |

⚠ **Changed 2026-09-25 by the operator:** toasts are short, one-line pills at
the top centre, at most two at once, and an alert no longer waits to be closed.
The toast only says something arrived; the inbox and the bell's count are
where it is read, so a long or large toast costs the view for nothing.

The durations are in `domain/toast.ts` and tested. Hovering or focusing a toast
pauses its timer, because a toast that disappears while someone is reading it
fails the only job it has.

## 5. Buttons: links and downloads

```ts
type NotificationAction =
  | { kind: 'link';     key: string; label: string; href: string; target: 'self' | 'blank' }
  | { kind: 'download'; key: string; label: string; href: string; filename?: string };
```

- `href` must be a same-origin path (`/…` but not `//…`) or `https://`
  (`http://` only when `NODE_ENV` is development). This check lives in the
  domain and runs at send time, so a `javascript:` URL is refused before it is
  stored. It runs again on read.
- `target: 'blank'` renders `rel="noopener noreferrer"`.
- The module hosts no files. A download points at an endpoint that authorises
  itself: a download link is a pointer and grants no access.
- **A link is not a permission.** Whatever it opens checks access again, which
  is why a link can safely outlive a membership (§3a).
- After `expiresAt` the buttons are hidden and the item says "This link has
  expired". The item itself stays.
- **No server-side action buttons.** An "Accept invitation" button that runs on
  the server was designed and dropped with invitations (§15, §16). If a real
  need appears, the design is recorded there, and it slots into this union as a
  third `kind` without a schema change.

## 5a. Batches, the compose page, and recall

- **`batchId`** is one ID per `send()` call, shared by every recipient's row.
  It is the unit of "what was sent", so the admin page lists batches, not
  thousands of rows: title, source, time, recipient count, read count.
- **The compose page sends as the system (decision 5).** The item shows the
  `admin` source ("Platform"), never the person. The batch records who pressed
  send (`senderId`), for audit only, on the Sent list. Anything person-to-person
  belongs in chat, and the compose page says so under its title.
- **Recall** is `Mutation.recallNotificationBatch(batchId)`:
  - It stamps `recalledAt` on every row in the batch, and every read filters
    recalled rows out. It is a soft delete, so the Sent list still shows what
    was recalled, when and by whom.
  - It publishes `recalled` to each recipient, so the item, its toast and its
    badge count disappear from every open tab immediately.
  - **It clears `dedupeKey`** on the recalled rows. Otherwise the
    `@@unique([recipientId, dedupeKey])` would silently swallow the corrected
    re-send, which is exactly what someone does right after a recall.
  - **Who may recall:** the person who pressed send, while they still hold
    `notification:send`; or anyone holding `notification:manage`. Producer
    batches (no `senderId`) are recalled only with `notification:manage`.

```prisma
model NotificationBatch {
  id             String    @id              // = NotificationItem.batchId
  senderId       String?                    // who pressed send on the compose page; null = a producer. Audit only
  source         String    @db.VarChar(64)
  title          String    @db.VarChar(160)  // what the Sent list shows
  recipientCount Int
  createdAt      DateTime  @default(now())
  recalledAt     DateTime?
  recalledById   String?
  @@index([createdAt, id])                  // the Sent list, keyset
  @@index([senderId, createdAt])            // "mine only"
  @@map("notification_batch")
}
```

## 6. Grouping

A producer can pass `group: { key, title }`, where `title` may contain
`{count}`: `{ key: 'ws:front-desk:joined', title: '{count} people joined Front desk' }`.

- **Folding happens at write time**, in the sender, inside one transaction. If
  the recipient has an **unread, unrecalled, unarchived** item with the same
  `groupKey`, that row is updated instead of a new one being written:
  `groupCount + 1`, `title` rendered from the group title, `body` and buttons
  replaced with the newest ones, and `occurredAt` = now. Otherwise a new row
  starts the group, and the first one keeps its own single title.
- **Once read, the group closes.** The next event starts a new row. Someone who
  has read "5 people joined" and then sees "6 people joined" would read that as
  one new person or six; neither reading is right.
- **The event is `created` or `grouped`**, and a `grouped` event updates the
  existing toast in place (same toast ID) and restarts its timer, rather than
  stacking a second one.
- The unread badge counts a group as **one**. It is one thing to look at.
- **Recall and grouping.** A folded row holds several sends in one row, so it
  can't be split when one of them is recalled. Two rules keep this honest:
  - The compose page offers no grouping. Everything a person can recall from
    the Sent list is therefore one row per recipient, and recalling it removes
    exactly that row.
  - A producer's group row keeps the `batchId` of the send that **started** it.
    Recalling that batch (`notification:manage` only) removes the whole group,
    and the confirm dialog says so. Recalling a later batch that only folded
    into it doesn't remove the row; it reports "N were folded into existing
    groups and could not be recalled". `grouped` in `send`'s result is how the
    admin page knows which case applies.
- `domain/grouping.ts` owns the fold decision and the `{count}` rendering.

## 7. Server API

**For people** (GraphQL). Every operation is app level: the inbox belongs to no
tenant, so there is no `REQUIRED_SCOPE_METADATA`, the same as chat.

| Operation | Key |
|---|---|
| `Query.notifications(first, after, before, order, unreadOnly, severity, source, organizationId, globalOnly, includeArchived)`: a page (§7a) | `notification:read` |
| `Query.notificationUnreadCount`: inbox items plus live unread announcements | `notification:read` |
| `Mutation.markNotificationsRead(ids)` / `markNotificationsUnread(ids)` | `notification:read` |
| `Mutation.markAllNotificationsRead(before)` | `notification:read` |
| `Mutation.archiveNotifications(ids)` / `unarchiveNotifications(ids)` | `notification:read` |
| `Query.activeAnnouncements` / `Mutation.markAnnouncementRead(id)` / `dismissAnnouncement(id)` | `notification:read` |
| `Query.notificationPreferences` / `Mutation.updateNotificationPreferences(input)` | `notification:read` |
| `Subscription.notificationEvents(since)` | `notification:read` |
| `Mutation.sendNotification(input)`: the compose page | `notification:send` |
| `Query.notificationBatches(first, after, before, mineOnly)`: the Sent list, paginated the same way | `notification:send` |
| `Mutation.recallNotificationBatch(batchId)` | `notification:send` (own) / `notification:manage` (any) |
| `Mutation.publishAnnouncement(input)` / `endAnnouncement(id)` / `recallAnnouncement(id)` | `notification:announce` |

- Every inbox read and write filters `recipientId = actor`, and every read
  filters `recalledAt is null`. An item that belongs to someone else is
  `not_found`, never `forbidden`, so the API does not confirm that it exists.
- **The bulk mutations take at most 100 IDs** (`NOTIFICATION_BULK_MAX`, in the
  domain). Above that the client pages; an unbounded `in` list is a query
  anyone can send (the same reason `permissions.service.ts` caps its lists).
  IDs that aren't the actor's are skipped, not reported, for the `not_found`
  reason above.
- `markAllNotificationsRead(before)` takes the newest `occurredAt` the client
  has seen. Without it, "mark all read" would also mark read the notification
  that arrived while the person was clicking.
- **Mark as unread** clears `readAt`, so the item moves back into the unread
  section, and a group can fold into it again. That is the intended reading of
  "I want to come back to this".

### 7a. Order and pagination (decision 2)

- **Default order: unread first**, then newest first within each section:
  `order: UNREAD_FIRST` (default) or `NEWEST` (a strict timeline, for someone
  looking for "what happened on Tuesday"). The panel always uses unread first.
- **Keyset, not offset.** New notifications arrive at the top while someone is
  on page 3. With `OFFSET` every arrival shifts every page by one, so an item is
  shown twice or skipped. A keyset cursor pins the position to a row.
- **The cursor carries the section.** `UNREAD_FIRST` is two ordered runs
  (unread, then read), each by `(occurredAt desc, id desc)`. The cursor is
  `{ section, occurredAt, id }`, opaque (base64) to the client and decoded only
  by `domain/ordering.ts`. A page that crosses the boundary finishes the unread
  run and continues into the read one. Both runs are served by the one
  `(recipientId, archivedAt, readAt, occurredAt, id)` index.
- **Both directions**: `after` for next and `before` for previous, so the page
  has real Prev/Next rather than "load more" only.
- **The page reports**: `items`, `pageInfo { hasNext, hasPrevious, startCursor,
  endCursor }`, and `totalCount` / `unreadCount` for the current filter. The
  counts come from the same indexes; the pager prints "41–60 of 1,284" from them
  and the page number it has walked to.
- **Page size**: 20 by default; 50 and 100 on the page. The server clamps to
  100, the same number as the bulk cap, so "select all on this page" is always
  one bulk call.
- **Items do not jump under the reader.** Marking an item read (by opening it,
  or in bulk) restyles it where it is. It moves to the read section only on the
  next fetch (changing page, changing filter, or pressing "Refresh", which
  appears once anything is stale). A list that re-sorts while someone is
  clicking through it moves the next row out from under the cursor. The client
  de-duplicates by `id` across pages, because an item marked read on page 1 can
  legitimately reappear on a later page of the read section.
- **New arrivals while paging**: page 1 takes them live. On any other page a
  "3 new — back to top" bar appears instead of inserting rows, for the same
  reason.

**For code** (in-process). `NotificationSender.send(input)` is exported from
`/server`:

```ts
send({
  recipientIds, severity, title, body?, source,
  context?,          // NotificationContext (§3a); omitted = global
  actions?,          // §5
  group?,            // §6
  dedupeKey?, expiresAt?,
}): Promise<{ batchId: string; written: number; grouped: number; overflowed: number }>
```

- The app injects it into its own adapters. **Other modules never import it.** A
  module that wants to notify someone declares its own port (for example
  `QUEUE_NOTIFIER`), and the app binds that port to the sender, the same way
  `CHAT_NOTIFIER` is bound to email today.
- `send` validates everything through `domain/compose.ts`: lengths, at most 3
  buttons with unique keys, safe hrefs, a **declared** `source` (§11), and at
  most `notification:recipients_per_send` recipients (a limit, §14). It writes
  the rows and the batch, applies grouping (§6) and the flood rule (§12), then
  publishes. **A failed publish does not fail a send.** The row is committed,
  and catch-up delivers it.
- The compose resolver calls the same `send`, with source `admin`, and records
  the actor on the batch. There is one write path, not two.

## 8. Realtime and the browser

**The socket.** This follows chat's shape as is:

- **One trigger**, `notification.event`, published through the app's single
  `realtimePubSub()` (Redis when `REDIS_URL` is set). Kinds: `created`,
  `grouped`, `read`, `unread`, `archived`, `recalled`, `announcement`.
  Everything after `grouped` exists to keep every open tab in step.
- **Filtered per publish**: an inbox event matches when
  `event.recipientId === actorId`, and an announcement event matches when
  `domain/announcements.ts` says its audience includes the actor (§9). Inbox
  events carry the item, because each is addressed to exactly one person, whom
  the filter has just checked.
- **Catch-up after every (re)subscribe** through `withCatchUp` from module-kit,
  so a notification sent while the socket was reconnecting is not lost.
- **The badge re-reads `notificationUnreadCount`** after an event instead of
  counting locally. The count rule stays in one place.

**The tab title.** `use-tab-title.ts` prefixes `document.title` with `(n) ` when
the unread count is above zero, using the same `99+` text as the badge.
- It **wraps** the title Next sets rather than replacing it. It re-applies the
  prefix when the route changes the title, and removes it when the count reaches
  zero or the component unmounts.
- ⚠ **One owner.** If chat later wants its unread count in the title too, the
  two must be summed in one place, never prefixed twice (`(2) (3) kwtech`). That
  would be a header-level slot in module-kit, and it isn't built until a second
  module asks for it.

**System pop-ups (the browser Notification API, not Web Push).**
- They are shown only when the page is **hidden** (`document.visibilityState`),
  permission is `granted`, and the device setting is on (§11). A visible tab
  already has the toast. `domain/browser-notify.ts` holds that rule.
- **Permission is requested only from a button** on
  `/notifications/preferences` ("Show pop-ups when this tab is in the
  background"). Browsers ignore or penalise prompts that aren't triggered by the
  user, and an unprompted permission dialog on page load is how the answer
  becomes "Block" forever.
- **One tab shows it, and none does if any tab is visible.** The tabs share
  their visibility over a `BroadcastChannel`. If *any* tab of the app is
  visible, that tab's toast is enough and no pop-up is shown. Otherwise the
  lowest-ID live tab shows it. Electing a leader alone would be wrong: the
  leader can be a hidden tab while the person reads another one, and they would
  get a toast and a pop-up for one event. Each pop-up also carries
  `tag = groupKey ?? id`, so the OS replaces duplicates. A browser without
  `BroadcastChannel` falls back to the tag alone.
- Clicking it focuses the tab and opens the item: its first link, otherwise
  `/notifications`. The pop-up shows the title only, never the body. The lock
  screen is outside the app.
- **Chat's `dnd` does not suppress it, or the toasts (decision 1).** `dnd` is a
  chat availability; these are system notifications, and the device settings
  (§11) are the way to quiet them. PLAN §12.44 says a badge is "still
  unclaimed", so its wording is updated in the same change: `dnd` covers chat's
  tone and chat's email, and nothing in `module-notification`.
- **What it doesn't do:** reach a closed browser. That needs Web Push (a service
  worker, VAPID keys, stored subscriptions), and is not planned (see §15).

## 9. Announcements: a message to everyone

A notification to everyone written as one row per user breaks twice: a large
fan-out write, and nothing reaches anyone who signs up after it was sent. So an
announcement is **one row**, and reads join it to the person:

```prisma
enum NotificationAudience { everyone organization }

model NotificationAnnouncement {
  id             String   @id @default(cuid())
  severity       NotificationSeverity @default(info)
  title          String   @db.VarChar(160)
  body           String?  @db.VarChar(2000)
  actions        Json     @default("[]")          // links and downloads, as on items
  audience       NotificationAudience
  organizationId String?                          // required when audience = organization
  contextLabel   String?  @db.VarChar(160)
  banner         Boolean  @default(false)         // also shown as a strip under the header
  startsAt       DateTime @default(now())
  endsAt         DateTime?                        // no job runner needed: "live" is computed on read
  senderId       String?                          // who published it. Audit only, never shown
  createdAt      DateTime @default(now())
  endedAt        DateTime?                        // ended early by hand
  recalledAt     DateTime?
  @@index([audience, startsAt])
  @@map("notification_announcement")
}

model NotificationAnnouncementReceipt {
  announcementId String
  userId         String
  readAt         DateTime?
  dismissedAt    DateTime?                        // the banner's ✕; it stays in the inbox
  @@id([announcementId, userId])
  @@map("notification_announcement_receipt")
}
```

- **Live is computed, not scheduled**: `startsAt <= now < endsAt`, and neither
  ended nor recalled (`domain/announcements.ts`). This needs no job runner
  (§12.40). A future `startsAt` is how "maintenance tonight" is posted this
  morning.
- **Audience.** `everyone` means every signed-in person, including people who
  sign up while it is live; that is the point of the design. `organization`
  means members of one organization, which the module can't know, so it asks the
  **`NOTIFICATION_AUDIENCE` port** (`isMember(userId, organizationId)`, and
  `organizationsOf(userId)` for the list query). The app binds the port to
  module-permissions. If the port is unbound, organization announcements reach
  nobody, and the compose page doesn't offer them.
- **Where it shows:** at the top of the bell panel and of `/notifications` in
  an "Announcements" strip above the inbox (not interleaved; merging two keyset
  sources for a feature this rare isn't worth it), and, when `banner` is set,
  as a strip under the header on every page until dismissed or ended. A live,
  unread announcement counts toward the badge. Receipts are written lazily (on
  read or dismiss), so an announcement to 10,000 people writes nothing until
  people interact with it.
- **Realtime**: publishing, ending or recalling it sends an `announcement`
  event, filtered per subscriber by audience, so the banner appears and
  disappears without a reload. A scheduled `startsAt` has no event; clients
  re-read `activeAnnouncements` on reconnect and once a minute while a banner
  may be due. That's cheap: one indexed query.
- **Toast**: an announcement toasts like an inbox item when it goes live while
  the person's tab is open, and appears in the strip otherwise.
- Its own key, `notification:announce`, is separate from `notification:send`:
  telling everyone is a bigger power than telling chosen people.

## 10. Realtime delivery: the person knows immediately

This is the point of the module. When something happens, or something goes
wrong, the person sees it **within about a second, in every open tab**, and
if their connection is down **they can see that it is down**. A bell that looks
fine while it isn't receiving is worse than no bell.

**From the event to the screen**
- **Publish in the same request, right after the commit.** No queue or job
  runner sits in between. The order is commit → publish → return. Publishing
  after the commit means a tab never receives an item that re-reading can't
  find.
- **The event carries the item** (§8), so the toast renders without a second
  request.
- **Across servers**, delivery depends on Redis. The existing boot check
  already refuses `REALTIME_REPLICAS > 1` without `REDIS_URL`. That check is
  what makes "realtime" true in production: without it, a notification reaches
  only the tabs connected to the server that sent it, with no error anywhere.
- **Measured, not assumed.** The sender logs publish time at `debug` and warns
  above 500 ms. An e2e test asserts that the toast appears within 2 seconds of
  the send.

**When the connection drops.** The weak point is the socket, not the server.
Three changes, two of them outside this module:
1. **The app's socket must never give up.** Today `providers.tsx` creates the
   shared connection without `retryForever`, so `graphql-ws` stops after five
   attempts (about 30 seconds of outage). After that nothing is live until a
   reload, and the only trace is a console warning. This already affects chat.
   The fix is one option in `apps/web-app/src/app/providers.tsx`, the same one
   the queue TV display uses. Backoff is `reconnectDelay` from module-kit: 1 s
   doubling to 15 s, with jitter. A refusal (4403, signed out) is still never
   retried.
2. **Reconnect at once when it's likely to work**, without waiting out the
   backoff: on the browser's `online` event, and when a tab becomes visible
   again (a laptop waking up). Dead connections are already detected by the
   20-second keepalive in module-kit.
3. **Make the connection state visible.** module-kit's `RealtimeProvider`
   gains a `useRealtimeStatus()` hook: `connecting | live | reconnecting |
   down`, and since when. It's fed by the `onConnected`/`onClosed` callbacks
   the connection already has. It belongs in module-kit because the socket is
   shared: chat and the queue can show the same state later without each
   inventing its own. The bell shows it:
   - **live**: nothing, the normal state
   - **reconnecting** for more than 3 seconds: a small grey dot on the bell,
     and in the panel "Reconnecting… new notifications will appear when it's
     back". The 3-second delay stops it flickering during the routine
     reconnect at token expiry.
   - **down** for more than 30 seconds: the dot turns to the warning colour,
     and the panel says "Live updates paused since 10:42", with a **Retry
     now** button. `domain/live-state.ts` holds the thresholds and is tested.

**Nothing is lost while down.** Every reconnect runs a catch-up read
(`withCatchUp`, §8), so items sent during the gap arrive. For those items:
- any **alert** gets its own toast. An alert is
  the thing the person most needs to see, and missing it because the Wi-Fi
  dropped would defeat the module.
- everything else becomes **one summary toast**: "3 notifications arrived while
  you were offline", which opens the panel. That's instead of either nothing,
  or a burst of stale toasts when a laptop opens.

**Reporting an error must not become a second error.** Producers often notify
from a `catch` block. So the sender exposes `sendSafely(input)`, which logs a
validation or database failure instead of throwing it. A failed publish never
throws in either form, because the committed row reaches the person through
catch-up.

**Alerts are the loudest path**, and all of it is in the browser: a 3-second toast, an
`assertive` live region, the sound when enabled (§11),
and a system pop-up when every tab is in the background (§8).

**No email and no presence tracking.** An earlier draft emailed alerts to people
who were offline, which needed "who is online" tracking. Both were dropped: the
requirement is immediate delivery to the screen, and the connection indicator
above tells the person when that isn't happening. See §15.

## 11. Preferences

**Per device** (`localStorage`, `kwtech_notification_settings`, validated on
every read the way chat's settings are):

| Setting | Default | Why that default |
|---|---|---|
| Toasts | on | They are the feature; hiding them by default hides it from everyone who never opens preferences |
| Sound | **off**, tone `Ding` | Same reason as chat: a back-office tab that starts making noise is a setting people hunt for angrily |
| System pop-ups in background | off until the person grants permission (§8) | The browser decides; we only ask from a button |

**Per person** (on the server, because a mute should hold on every device):

```prisma
model NotificationPreference {
  userId         String   @id
  mutedSources   String[] @default([])
  updatedAt      DateTime @updatedAt
  @@map("notification_preference")
}
```

- **Sources are declared, not free text.** The app passes
  `sources: [{ key, label, mutable }]` to `notificationServerModule({...})`.
  `send` refuses an undeclared source. The item shows the source's label, and
  the preferences page lists them by label, so a raw key never reaches the
  screen. The module declares `admin` ("Platform") itself, because the compose
  page needs it in every app.
- **`mutable: false`** is for what must always arrive: security notices, and
  `admin` (a super-admin telling everyone something is the one message that must
  not be mutable). Those sources show on the preferences page without a switch,
  with the sentence "Always delivered."
- **What muting does:** a muted source's items are **still stored and still
  listed**, with a "muted" chip. They don't toast, don't play a sound, don't
  show a system pop-up, and don't count toward the badge.
  Nothing is lost, and unmuting shows everything that was held back. In the
  unread-first order they sit in the unread section, after the unmuted ones.
  `domain/preferences.ts` is the one place this list is written down, and the
  badge count query uses it.

## 12. Flood limit

A buggy producer in a loop should become one row, not ten thousand.

- **The rule, per recipient per source:** at most 20 items a minute
  (`notification:per_source_per_minute`, a limit, §14; unset means the floor
  from the domain, never unlimited). It is counted with the
  `(recipientId, source, createdAt)` index, in the database rather than in
  memory, so a restart doesn't reset it and two replicas share it.
- **Over the limit, items fold into an overflow group** instead of being dropped
  (`groupKey = overflow:<source>`, title "{count} more from <source label>"). The
  person sees that something is happening; the producer's bug doesn't turn into
  their inbox.
- `send` returns `overflowed`, and the first overflow of a batch is logged once
  at `warn` with the source. The log, not the inbox, is where a loop should be
  noticed.

## 13. The web side

- **Connection state on the bell** (§10): nothing when live, a grey dot when
  reconnecting for more than 3 s, and a warning dot when down for more than
  30 s, with "Live updates paused since …" and **Retry now** in the panel.
- **Header tool**: `{ key: 'notifications', label: 'Notifications', order: 20,
  feature: NOTIFICATION_FEATURE.read }`. Chat is at 10, so the bell sits to the
  right of chat, beside it. With chat off, the bell is the only tool and sits
  alone; nothing here refers to chat's tool. The badge shows `domain/unread.ts` output (`99+`
  cap) and has an `aria-label` that states the full number.
- **Panel**: the announcements strip, then the first 10 items in unread-first
  order, "Mark all read", a settings link, and "View all" to `/notifications`.
  Clicking an item marks it read and follows its first link, if it has one; the
  item is restyled in place and re-sorted the next time the panel opens (§7a).
- **Toasts**: rendered by the header tool, which is mounted on every signed-in
  page. They are portalled to `<body>` and placed at the **top centre, under
  the header** (see §4 for the 2026-09-25 change), one line each. At most 2 are
  visible and the rest are queued; a `grouped` event updates its toast in place.
  A live `created`/`grouped` event gets its own toast. Items that arrive by
  catch-up after a reconnect follow §10 instead: each alert gets its own toast,
  and the rest become one summary toast, so opening a laptop neither hides an
  alert nor releases a burst of stale toasts. While `/notifications` is open, new items
  appear in the list and no toast is shown (its own
  `useNotificationsPageOnScreen`, modelled on chat's hook, not imported). A
  `recalled` event removes its toast.
- **`/notifications`**: an unlisted route like `/chat`, so the header is the
  only way in. It has:
  - **Unread first** by default, with a "Newest first" toggle (§7a); All,
    Unread and Archived tabs; filters for severity, source, and where it came
    from (All · Global · each organization seen in the list)
  - the source label, the context label as a chip (none for global), the group
    count, the "muted" chip, and the buttons
  - **pagination** (§7a): page size 20/50/100 (remembered per device), Prev and
    Next, "41–60 of 1,284", the "N new — back to top" bar, and "Refresh" once
    the page is stale
  - **bulk select**, with a checkbox per row and "select all on this page",
    then Mark read / Mark unread / Archive (one call, because a page is at most
    100)
  - **Mark as unread** and **Archive** / **Unarchive** on each row's menu
  - the page and filters live in the URL (`?page=…&order=…`), so Back and a
    shared link restore them
- **`/notifications/preferences`**: an unlisted route with the device and
  person settings (§11), the tone preview button (which is also the audio
  unlock, as in chat), and the system pop-up permission button.
- **`/admin/notifications`**: a drawer entry in Administration, behind
  `notification:send`. It has two tabs:
  - **Compose**: choose recipients (people via the directory port, as chat's
    `person-finder` does), the severity, title, body, an optional link and an
    optional context. It sends as the system (§5a), and a line under the title
    says "To message someone personally, use chat." With
    `notification:announce` it can instead publish an announcement: everyone
    or one organization, a banner option, and start and end times.
  - **Sent**: the batches and announcements, paginated, with who sent each, read
    counts, and Recall/End.
- **One hook, `useNotifications`**, shared by the bell, the panel, the toasts,
  the tab title and the system pop-ups: one socket subscription, as in chat.
- **Accessibility**: the toast region is always in the DOM with the right
  `aria-live`. Buttons are real `<a>` and `<button>` elements. Escape dismisses
  the newest toast. Bulk select works by keyboard (Space toggles, Shift+Space
  extends the selection). The pager is a `<nav aria-label="Pagination">`.
- **Sound, and a shared-code step that comes first.** The tones are synthesised
  in `module-chat` (`chat-tone.ts`: the catalogue and the oscillator player).
  This module would be their second consumer, so by principle 9 they **move to
  `@kwtech/web-ui`** in a separate `refactor(web-ui)` commit before phase 3.
  Chat keeps `shouldPlayTone`, its own rule for *when*, and its settings; only
  the *how* moves. The brand-name test moves with the catalogue. Copying the
  code into this module instead would leave two tone catalogues that drift
  apart.
- The toast stays **inside this module**. `web-ui` has no toast today, and
  principle 9 says to extract one only when a second consumer exists.

## 14. Features, limits, presets, ports, wiring

**Features** (all app level):

| Key | Grants | Who holds it |
|---|---|---|
| `notification:read` | your own inbox, announcements, your preferences | the `notification-user` preset → `normal-user` |
| `notification:send` | compose as the system; see and recall your own batches | `super-admin` only (decision 5) |
| `notification:announce` | publish, end and recall announcements | `super-admin` only |
| `notification:manage` | recall any batch, including producers' | `super-admin` only |

`super-admin` bypasses the check, so the last three need no grant at all; they
exist so that a narrower role can be given one of them later without a code
change. `app-roles.ts` grants the `notification-user` preset to `normal-user`
by reading `NOTIFICATION_ROLE_PRESETS`, as it does for `chat-user`.

**Limits** (`NOTIFICATION_LIMIT_REGISTRY`, app level, each with a floor in the
domain so that unset never means unlimited; starting values confirmed,
decision 6):
- `notification:recipients_per_send`: 500
- `notification:per_source_per_minute`: 20

**Ports**:

| Token | Unbound means |
|---|---|
| `NOTIFICATION_PRISMA` / `_PRISMA_WRITE` | no database; the module opens no connection of its own |
| `NOTIFICATION_PUBSUB` | it works over HTTP; it is not live |
| `NOTIFICATION_AUDIENCE` | organization announcements reach nobody and aren't offered |
| `NOTIFICATION_LIMIT_CHECKER` | the domain floors apply |
| `NOTIFICATION_USER_DIRECTORY` | the compose page can't find people by name |

**App wiring** follows the CLAUDE.md checklist:
- `package.json` in both apps
- `SERVER_MODULES` in `app.module.ts`, with every port above and the declared
  `sources`
- `module-clients.ts` and `satisfies-modules.ts`
- `MODULE_DECLARATIONS` in `seed/registry.ts`
- `app-roles.ts`
- `WEB_MODULES`
- `db:migrate`, then `db:sync`

App adapters go in `apps/web-server/src/notifications/`: `sources.ts`,
`audience.ts`, `user-directory.ts`. None of them reads
anything from chat (§1a).

## 15. Not doing, and why

| Not doing | Why | What would change it |
|---|---|---|
| Person-to-person messages | That is chat. Here the system is the only sender, and the compose page sends as the system (decision 5) | — |
| Server-side action buttons ("Accept invitation") | Their one use case was invitations, which were dropped (§16). The design, kept for the day it's needed: the client sends only `(notificationId, actionKey)`, the stored payload never reaches the browser, handlers are an app-bound port, an unbound command fails at send, and a conditional update claims the item so a double click can't run it twice | a second concrete use case |
| Deleting old notifications | Decision 2: keep everything. Archive and recall hide; pagination copes (§7a) | a real storage problem, answered by partitioning or an archive table |
| Scheduled sending of inbox items | There is no job runner (§12.40). Announcements get `startsAt` because "live" is computed on read, which needs none | a job runner |
| Snooze / remind me later | It needs something to wake up at a time: the same job runner | a job runner |
| Rich text or HTML bodies | Plain text can't inject anything. Links belong in buttons, which are validated | a sanitiser with a strict allow-list, if a real need appears |
| Web Push (closed browser) | A service worker, VAPID keys, a subscription table and a delivery path. The requirement is immediate delivery to an open app (§10) | people needing alerts with the app closed |
| Email for alerts, and "who is online" tracking | Dropped: the goal is immediate on-screen delivery, and the connection indicator (§10) says when that isn't happening | alerts that must reach people who don't have the app open |
| Chat messages as notifications | Chat has its own badge, tone and email | — |
| A shared tab-title slot in module-kit | Only one module wants it today (§8) | chat wanting its count in the title |

## 16. Invitations: dropped, and the link option if it comes back

Dropped from this plan (decision 3). What was designed was an in-app
Accept/Decline that ran on the server; it needed two changes in
module-permissions and depended on how account emails are verified.

The simpler version, **a notification with an "Open invitation" link**, was
suggested in its place. It is deliberately **not** in the plan yet, because of
one cost that needs a decision:

- The only working link to an invitation is the emailed one, and it **contains
  the token**. module-permissions stores only the token's SHA-256 hash, so the
  database can't be used to accept an invitation. Putting the link in
  `notification_item.actions` would store the raw token in the database, and
  anyone with read access to that table could accept the invitation.
- The ways out:
  - accept that cost, with `expiresAt` set to the invitation's expiry so the
    button disappears with it
  - link to a signed-in "Your pending invitations" page instead. That needs no
    token, but it is a new page in module-permissions
- Either way it is a producer the app adds later through
  `sendInvitationEmail` (`apps/web-server/src/permissions/invitation-mail.ts`),
  with no change to this module. Nothing here blocks it.

## 17. Phases

1. **Module core.** Schema and migration (items and batches), the domain and
   its tests, repository, service, sender, resolvers, subscription, app
   wiring, seed and presets, declared sources, the flood limit, bell, panel,
   toasts, and `/notifications` with **unread-first pagination**, mark as
   unread, archive and bulk select, plus the tab title.
   **Realtime delivery (§10)** is also in phase 1, because it is the point of
   the module:
   - `retryForever` on the app's socket (`providers.tsx`)
   - reconnecting immediately on `online` and when a tab becomes visible
   - `useRealtimeStatus()` in module-kit, and the bell's connection dot
   - the catch-up toasts: one per alert, a summary for the rest
   - `sendSafely`
   The module-kit and `providers.tsx` changes land as their own commit first,
   `fix(web-app)` / `feat(module-kit)`, because they change chat's behaviour
   too, for the better. This ships alone and is usable.
   Verify with a dev-only script (`pnpm --filter @kwtech/web-server notify:demo`,
   refusing to run unless `NODE_ENV=development`) that sends one notification of
   each severity, with a link and a download, enough items to fill three pages,
   and a burst that trips the flood limit. **Not a seeder:** seeders write
   reference data idempotently. This writes user data, and it must never run
   against a profile that isn't `local`.
1b. **Grouping, recall and system pop-ups.** Each touches something phase 1
    must already have right (the fold transaction, the realtime `recalled`
    path, cross-tab visibility), so they land as a second PR against a working
    core rather than inside it.
2. **Admin compose and Sent** at `/admin/notifications`: compose as the system,
   the batch list, recall.
3. **Preferences and sound.** The tone extraction to `web-ui` first (its own
   commit), then `/notifications/preferences`, `NotificationPreference`, muted
   sources and device settings.
4. **Announcements**: the tables, the audience port, the banner, the strip, and
   compose and end in the admin page.
Phases 2–4 are independent and can be reordered.

**Tests**:
- **the domain**: href safety, action parsing, context mapping, ordering (the
  unread-first cursor, crossing the unread/read boundary, both directions, a
  tampered cursor refused), grouping (folding, the `{count}` title, closing a
  read group), the flood rule (the floor, overflow), toast timing, badge and
  tab-title text, the live-state thresholds, what muting suppresses,
  announcement liveness and audience, browser-notify visibility
- **the service against `fake-client.ts`**:
  - access: the recipient filter, `not_found` for someone else's item, recalled
    rows never returned
  - pagination: no row repeated or skipped when an item arrives mid-walk; the
    page-size clamp
  - dedupe, and that a recall frees the dedupe key
  - bulk: the cap, and skipping IDs that aren't yours
  - recall: who may recall
  - `sendSafely` never throws; a failed publish never fails a send
- **independence**: the app boots with chat disabled and with notifications
  disabled, and the other module's operations still validate and answer (§1a)
- **realtime**: per-publish filtering, for inbox events and for announcement
  audiences
- **the `feature-keys` and limit shapes**; the tone catalogue's brand-name test
  after it moves
- **module-kit**: `useRealtimeStatus` transitions from the connection
  callbacks; `reconnectDelay` is unchanged
- **the web-module test**, pinning header tool order 20 and the admin entry's
  group
- `module-operations.test.ts`
- **Playwright e2e**:
  - send → toast **within 2 s** → badge 1 → tab title `(1)` → open panel →
    mark read → badge 0 → title cleared
  - cut the socket (block the WebSocket route) → the dot appears within 30 s →
    send two infos and one alert → restore → the dot clears, one alert toast and
    one "2 notifications arrived while you were offline" toast
  - keep the socket down for more than 5 reconnect attempts → it still
    reconnects when restored (the `retryForever` regression)
  - 45 items, 10 unread → page 1 starts with the 10 unread → Next → Prev lands
    on the same rows
  - send five in one group → one row, count 5, one toast
  - recall → the item disappears from an open second tab
  - bulk-select three → mark unread → badge 3

## 18. Decisions

Answered 2026-09-25:

1. **`dnd` does not silence notifications.** Toasts and pop-ups ignore chat's
   availability; the device settings are the way to quiet them. PLAN §12.44 is
   reworded in the same change (§8).
2. **Keep everything; paginate; unread first by default.** No automatic
   deletion. `/notifications` pages with keyset cursors (§7a), and the growth
   becomes a PLAN §12 entry.
3. **Invitations are dropped.** The in-app Accept button and its
   module-permissions changes are out, and with them server-side action
   buttons. The link-only version waits on the token question in §16.
4. **Notifications stay visible after someone leaves an organization.** They
   are the person's, not the tenant's. Links check access when opened.
   Organization *announcements* still follow their audience: they are shown
   only while live, and only to current members, because an announcement is
   addressed to the organization rather than to the person.
5. **Sending is super-admin only, and always as the system.** People who want
   to tell someone something use chat.
6. **Starting limits: 20 per source per minute, 500 recipients per send.**
7. **Realtime delivery matters; online status doesn't.** No presence tracking
   and no alert emails. Instead the socket never gives up, the bell shows when
   it isn't live, and nothing missed while down is lost (§10).

Still open:

- **§16: an invitation link in a notification** stores the invitation token in
  the database. Accept that, build a "pending invitations" page, or leave
  invitations to email. It is only needed if invitations come back.
