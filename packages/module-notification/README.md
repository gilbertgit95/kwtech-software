# @kwtech/module-notification

System notifications for a person, across every organization and workspace:
a bell in the header with the live unread count, toasts the moment something
arrives, and a paginated inbox. The system is the sender. People who want to
tell each other something use chat.

It is a PEER of `module-chat`, not a part of it. Neither imports or needs the
other; each works with the other switched off.

The design and the decisions behind it are in
[`docs/NOTIFICATIONS-PLAN.md`](../../docs/NOTIFICATIONS-PLAN.md).

## In a Next.js app

```ts
// src/modules.ts
import { notificationWebModule } from '@kwtech/module-notification/react';
export const WEB_MODULES = [/* … */ notificationWebModule()];
```

That contributes:

| What | Where | Key |
|---|---|---|
| The bell (header tool, order 20 — right of chat's 10) | the header | `notification:read` |
| Toasts: one-line pills, top centre under the header, 2–3 s, at most two at once | every signed-in page | — |
| `/notifications`, the inbox | unlisted: the bell is the way in | `notification:read` |
| `/notifications/preferences`, this device's settings | unlisted | `notification:read` |
| `/admin/notifications`, compose and Sent | drawer, Administration | `notification:send` |

`notificationWebModule({ enabled: false })` contributes the keys and nothing
else, so a feature sync does not strip them from every role while it is off.

⚠ **Set `retryForever: true` on the app's socket** (`createRealtimeConnection`).
Without it the socket gives up after about thirty seconds of outage and the
bell silently stops being live. See module-kit's README.

## In a NestJS app

```ts
const NOTIFICATIONS = notificationServerModule({
  prismaProvider: notificationPrismaProvider,
  prismaWriteProvider: notificationWritePrismaProvider,
  pubsubProvider: { provide: NOTIFICATION_PUBSUB, useValue: realtimePubSub() },
  userDirectoryProvider: { provide: NOTIFICATION_USER_DIRECTORY, /* … */ },
  resolveActorId: (request) => resolvePrincipal(request)?.userId,
  sources: [{ key: 'queue.session', label: 'Queue', mutable: true }],
  allowHttpLinks: env.NODE_ENV === 'development',
});
```

Add the registry to the app's `MODULE_DECLARATIONS` too: the bindings are the
guard, and an uncomposed registry leaves every operation — including sending as
the platform — open to anybody signed in.

| Option / port | Unbound means |
|---|---|
| `prismaProvider` / `prismaWriteProvider` | no database — the module opens no connection of its own |
| `pubsubProvider` | not live: the inbox works over HTTP, nothing arrives by itself |
| `userDirectoryProvider` | the compose screen finds nobody; the Sent list shows no names |
| `resolveActorId` | nobody is signed in — every operation refuses |
| `sources` | only `platform` exists; any other send is refused |
| `maxRecipientsPerSend` | 500 |
| `floodLimitPerMinute` | 20 (a bad value falls back to 20, never "unlimited") |
| `allowHttpLinks` | off: buttons link to paths or `https://` only |

⚠ The two limits are options, not role limits: module-kit's limit checker
resolves a cap for an acting PERSON, and nearly every send has none.

### Sending

`NotificationSender` is exported from `/server`. The app injects it into its
adapters; **other modules never import it** — a module that wants to notify
somebody declares its own port, and the app binds that port to the sender.

```ts
await sender.send({
  recipientIds: [userId],
  severity: 'alert',                 // info | success | warning | alert
  title: 'The queue session stopped',
  body: 'Every display went dark.',  // plain text, never HTML
  source: 'queue.session',           // must be declared in `sources`
  context: { scope: 'workspace', organizationId, workspaceId, label: 'Acme · Front desk' },
  actions: [{ kind: 'link', key: 'open', label: 'Open queue', href: '/…', target: 'self' }],
  group: { key: `ws:${workspaceId}:joined`, title: '{count} people joined' }, // optional
  dedupeKey: `session:${sessionId}:stopped`,                                   // optional
});
```

`sendSafely(input)` does the same and never throws — for a producer reporting a
failure from a `catch` block, where a second error would bury the first.

### Notifying people from another module — step by step

This is the recipe for "feature X should tell somebody when Y happens". Say
the queue wants to tell a workspace's staff that a session was stopped.

**1. In the producing module, declare a port.** Never import this module.

```ts
// packages/module-queuing-window/src/server/ports.ts
/** Telling people about queue events. Unbound means nobody is told. */
export interface QueueNotifier {
  sessionStopped(event: {
    recipientIds: readonly string[];
    organizationId: string;
    workspaceId: string;
    workspaceLabel: string;
    consoleHref: string;
  }): Promise<void>;
}

// queue.tokens.ts
/** A `QueueNotifier`. Unbound means nobody is told — the queue still works. */
export const QUEUE_NOTIFIER = 'kwtech:queue-notifier';
```

Add `notifierProvider?: unknown` to the module's options, bind it to
`undefined` when absent (`@Optional() @Inject(QUEUE_NOTIFIER)`), and call it
**after the commit**, never inside a transaction — and never let it fail the
write:

```ts
await this.notifier?.sessionStopped({ … }).catch((error) => this.logger.warn(…));
```

The port speaks the MODULE's language (a session stopped), not this module's
(severity, source). Choosing the words is the app's job, next.

**2. In the app, declare the source** in
`apps/web-server/src/notifications/sources.ts`:

```ts
{ key: 'queue.session', label: 'Queue', mutable: true },
```

`mutable: false` only for what must always arrive (security notices).

**3. In the app, write the adapter** in `apps/web-server/src/queue/notifier.ts`:

```ts
export class QueueNotifierAdapter implements QueueNotifier {
  constructor(private readonly sender: NotificationSender) {}

  async sessionStopped(event: Parameters<QueueNotifier['sessionStopped']>[0]): Promise<void> {
    await this.sender.sendSafely({
      recipientIds: event.recipientIds,
      severity: 'warning',
      title: 'The queue session was stopped',
      source: 'queue.session',
      context: {
        scope: 'workspace',
        organizationId: event.organizationId,
        workspaceId: event.workspaceId,
        label: event.workspaceLabel,
      },
      actions: [{ kind: 'link', key: 'open', label: 'Open queue', href: event.consoleHref, target: 'self' }],
    });
  }
}
```

**4. Bind it in `app.module.ts`.** The notification module is NOT global, so
the producing module must import it to inject `NotificationSender` — pass the
SAME dynamic module object (Nest dedupes by reference; a second
`notificationServerModule()` call would build a second, disconnected sender).
Declare `NOTIFICATION_SERVER_MODULE` ABOVE the producer's descriptor in
`app.module.ts` — a `const` cannot be read before its line:

```ts
imports: [NOTIFICATION_SERVER_MODULE.nestModule],
notifierProvider: {
  provide: QUEUE_NOTIFIER,
  inject: [NotificationSender],
  useFactory: (sender: NotificationSender) => new QueueNotifierAdapter(sender),
},
```

**5. Test** the producing module against a fake notifier (it was called, with
what), and the adapter against a fake sender. Nothing else changes: the bell,
toasts and inbox pick it up.

### Choosing what to send

| Question | Guidance |
|---|---|
| Severity | `info` news · `success` something finished · `warning` needs attention soon · `alert` urgent. Alerts are announced assertively and play louder; use them sparingly or people learn to ignore them |
| Source | One per KIND of event people might want to mute ("Queue", "Billing"), not one per event |
| Title | The whole message in one line — the toast shows only the title |
| Body | Optional detail, plain text, up to 2000 characters. Never secrets: it is stored and shown in the inbox |
| Context | Set it whenever the event belongs to an organization or workspace; leave it out for platform-wide or account-level events |
| Buttons | At most 3; the first is the main one. A path (`/…`) stays in the app, `https://` opens a new tab |
| `dedupeKey` | When the same event could be reported twice (a retry, two replicas): `session:${id}:stopped` |
| `group` | When the same kind of event repeats for one person ("3 people joined"). Not with `dedupeKey` |
| `expiresAt` | When the button stops making sense (an offer, a download link) |
| `send` or `sendSafely` | `sendSafely` from a `catch` block or anywhere a failure to notify must not become a failure of the work |

## Realtime

- **One trigger**, `notification.item`, filtered **per publish** by recipient:
  an event reaches one person's sockets and nobody else's. It carries the
  notification, so a toast needs no second request.
- **Published after the commit**; a failed publish never fails a send.
- **`sync` opens every (re)subscribe.** The client re-reads on it, and after a
  reconnect asks `notificationsSince` for what it missed: each missed ALERT gets
  its own toast, the rest one summary. There is no `since` argument on the
  subscription because `graphql-ws` re-sends a subscription's original
  variables on every reconnect.
- **The bell shows the connection**: a grey dot after 3 s of reconnecting, a
  warning dot and "Live updates paused since …" with **Retry now** after 30 s.
- Measured on a local stack: about 40 ms from send to event.

## The screens

| Screen | What people get |
|---|---|
| **Bell** (header) | Live unread count (99+), a dot while reconnecting and "Live updates paused" with **Retry now** after 30 s; a panel of the latest 10, unread first, Mark all read, View all |
| **Toasts** | One-line pills at the top centre under the header: the type icon, the title, the source. 2 s (info, success) or 3 s (warning, alert); hover pauses; at most two at once, "+N more" beyond. Missed while offline: each alert its own pill, the rest one summary. Quiet while `/notifications` is open |
| **Tab title** | `(3) kwtech` while anything is unread |
| **`/notifications`** | All / Unread / Archived; filter pills (order, type, source, where from) with Clear filters; rows grouped by day with an unread accent, "Show more" for long text, tools on hover; a floating bulk bar; Previous/Next with 20/50/100 per page; live arrivals |
| **`/notifications/preferences`** | This device: toasts on/off, sound on/off and which, browser pop-ups when every tab is hidden |
| **`/admin/notifications`** | Compose: recipient search with chips, type cards, title and details with counters, an optional button, a live preview. Sent: sends by day with type, sender, time, a read bar, "Sent by me", and Recall |

## Vocabulary

| Term | Meaning |
|---|---|
| severity | how loud: `info`, `success`, `warning`, `alert` |
| source | what it is about, as declared by the app: "Queue", "Platform" |
| context | where it came from: global, an organization, or a workspace — never who may see it |
| batch | one `send()` call; what the Sent list shows and a recall acts on |
| group | rows folded into one: "5 people joined" |

## The domain entry point

`@kwtech/module-notification` is framework-free: `prepareSend`,
`prepareActions` / `checkHref`, `planPage` and the cursor, `renderGroupTitle`,
the flood rule, `badgeText` / `tabTitle`, `toastDurationMs`,
`planMissedToasts`, `liveIndicator`, `shouldShowSystemPopup`, and the
GraphQL documents (`NOTIFICATION_OPERATIONS`).

## Buttons

Links and downloads only, at most three. `href` is a same-origin path (not
`//…`) or `https://`; `javascript:`, `data:` and other schemes are refused at
send AND dropped on read. An external link always opens in a new tab with
`noopener noreferrer`. A download is a pointer to an endpoint that authorises
itself. After `expiresAt` the buttons are gone and the item says so.

## The inbox

- **Unread first** by default, newest first within each run; "Newest first" is
  a strict timeline.
- **Keyset pages**, both directions, with the run in the cursor so a page can
  cross from unread to read. A new arrival never repeats or skips a row. A
  tampered cursor is refused, not silently restarted.
- **Rows do not move under the reader**: marking read restyles in place; the
  next fetch re-sorts. Page 1 takes arrivals live; other pages show "N new —
  back to top". A recall removes its rows at once, on any page.
- State lives in the URL, so Back and shared links restore it.
- Bulk select at most a page (100), which is also the server's cap.
- **Nothing is deleted.** Archive and recall hide. See PLAN §12.73.

## Grouping and the flood rule

A producer's `group` folds a send into the recipient's UNREAD row with the same
key; once read, the next one starts a fresh row. Past 20 a minute from one
source, the surplus folds into one overflow row ("11 more notifications from
Queue"), logged at `warn`. A group is as loud as its loudest member.

## Recall

`recallNotificationBatch` stamps `recalledAt` on every row of a send, clears
their dedupe keys (so the corrected re-send goes through), and publishes
`recalled`, which removes the item and its toast from every open tab. It cannot
un-read something already read. A row that later sends folded into keeps the
batch that started it; the compose screen offers no grouping for that reason.

## This device

`/notifications/preferences` (localStorage, `kwtech_notification_settings`):
toasts (on), sound (off, with the tone engine from `@kwtech/web-ui` and this
module's own catalogue), and the browser's own pop-ups when every tab is in the
background — asked for only from a button, shown by one tab only, title and
source only, never the body.

## What it declares

| Declaration | Registry |
|---|---|
| Features | `NOTIFICATION_FEATURE_REGISTRY`: `notification:read`, `notification:send` (privileged), `notification:manage` (privileged) — all app level |
| Role preset | `NOTIFICATION_ROLE_PRESETS`: `notification-user` → `notification:read` |

Adopting the module grants nobody anything. This app grants the preset to
`normal-user`; sending and recalling are `super-admin` only.

## Dev

`pnpm --filter @kwtech/web-server notify:demo --to=<email>` fills one local
inbox with every kind of notification, a group and a flood. Local profile and
development build only. Without `REDIS_URL` its events cannot reach the running
server's sockets; reopen the bell.
