# @kwtech/module-chat

Messaging as a whole vertical slice: schema, pure domain rules, the server, the
realtime tier, `/chat`, and the ephemeral layer (presence, availability,
typing).

Adopting it is **one descriptor per surface**. Every port has a default, and a
host that fills in none of them still gets a working chat — unguarded, not live,
and functional.

## In a Next.js app

```ts
// src/modules.ts
import { chatWebModule } from '@kwtech/module-chat/react';
export const WEB_MODULES = [chatWebModule()];
```

That contributes `/chat`, its drawer entry with the live unread badge, and the
unlisted `/chat/:conversationId/settings` page.

## In a NestJS app

```ts
// src/app.module.ts
import { chatServerModule } from '@kwtech/module-chat/server';

const CHAT = chatServerModule({
  prismaProvider: { provide: CHAT_PRISMA, useExisting: PrismaService },
  prismaWriteProvider: { provide: CHAT_PRISMA_WRITE, useExisting: PrismaService },
  resolveActorId: (request) => resolvePrincipal(request)?.userId,
});
```

Importing the module **is** the registration: the resolver joins the composed
schema because the driver walks the container. `enabled: false` returns a module
that registers nothing at all — one place, so a "disabled" chat cannot still
answer a GraphQL query.

## The ports a host fills in

Every one is optional, and the table says what its absence MEANS rather than
listing it as missing. That is the design: a module must run in an app with no
permission model at all.

| Port | Unbound means |
|---|---|
| `prismaProvider` / `prismaWriteProvider` | no database — the module opens no connection of its own, ever |
| `userDirectoryProvider` | nobody can be found by name; conversations still work by id |
| `limitCheckerProvider` | **no cap.** ⚠ A host that meant to enforce one and forgot the binding gets silence |
| `pubsubProvider` | chat works over HTTP alone. It is simply not live |
| `platformAdminProvider` | **nobody** administers a conversation they are not in |
| `defaultsProvider` | every default is unset: the creator owns the group, everybody else joins as a member |

None of them may be a direct import of another module. `module-chat` declares
`chat:manage_all`, `chat:group_chats` and its two defaults; it cannot CHECK a
key, resolve a cap or read a default, because all three are
`@kwtech/module-permissions`' questions and §9 forbids a module importing a
module. The APP is the only layer that depends on both, so the app answers —
see `apps/web-server/src/chat/` for the three adapters.

## Realtime — and the ONE deployment decision chat forces

Chat is the feature that makes pub/sub unsurvivable to get wrong. A plan badge
arriving late is a stale screen; **a message that never arrives is a broken
product**, and the sender sees it as sent.

The module never picks a transport. It declares `CHAT_PUBSUB` — publish and
subscribe, nothing else — and the app binds an engine to it.

⚠ **In `apps/web-server` that engine is chosen by ONE environment variable:**

```bash
REDIS_URL="redis://localhost:6379"   # set → Redis. unset → in-memory.
```

Nothing else. No rebuild, no flag, no code change; the boot log says which
engine won. `src/realtime/realtime.pubsub.ts` is the one place it is decided,
and a module that needed to know which one it got would be a leak.

**What the in-memory engine costs, stated rather than discovered:** it serves
exactly the sockets its own process holds. Past one replica an event published
on replica A never reaches a socket held by replica B — **with no error
anywhere**. Subscriptions look connected and deliver to a fraction of users. So
`REALTIME_REPLICAS > 1` with no `REDIS_URL` **fails the boot**, which is the
loud version of a failure that is otherwise invisible until people report that
half of them see nothing.

With `REDIS_URL` set, the replica count is not consulted at all.

### Three properties the transport does not get to break

1. **Events are filtered PER PUBLISH, re-checking participation** — never once
   at subscribe. A subscription is authorised at subscribe and then streams, so
   somebody removed from a group would otherwise keep receiving it until their
   socket closed.
2. **Every (re)subscribe is followed by a catch-up read.** The socket closes
   when its authorization expires, by design, and pub/sub has no replay — so
   every event published in the gap is gone. The socket is the fast path; the
   query is the truth.
3. **A chat event CARRIES the message.** Events are already filtered per
   recipient, so by the time one is sent the server has established this reader
   may see it. Making them re-read would cost a round trip on the one path where
   latency is the product.

## Participation is not permission

⚠ The rule this module is built around. `chat:send` says you may use chat; it
says nothing about conversation 42. So `canAccessConversation` is enforced **on
the server** — every read, every send, every published event — and the keys are
the second half of an authorisation, never the whole of one.

No read-any-conversation key exists at all. `chat:manage_all` admits
administering a conversation its holder is not in — renaming it, changing who is
in it, deciding who runs it — and **not one word of what was said in it**.

## What it declares, for the app to compose

| Declaration | Registry | Composed by |
|---|---|---|
| Features | `CHAT_FEATURE_REGISTRY` | `composeFeatures` |
| Caps | `CHAT_LIMIT_REGISTRY` | `composeLimits` |
| Defaults | `CHAT_DEFAULT_REGISTRY` | `composeDefaults` |
| Their section headings | `CHAT_DEFAULT_MOMENT_REGISTRY` | `composeDefaultMoments` |

⚠ Adopting the module grants **nobody** anything. The module ships the shape and
seeds nothing; a host says who may use chat by adopting the `chat-user` preset
into one of its own roles.

## Unread

`lastReadMessageId` on `ChatParticipant`, monotonic with the keyset ordering
`(createdAt, id)`. Counted as messages after it, excluding your own, excluding
`kind: system`, and excluding tombstones.

⚠ **One grouped query, never a count per conversation.** The nav badge re-reads
on every event the socket delivers — deliberately, rather than counting locally,
because counting locally means reimplementing the rule in a second place — so a
per-conversation count runs again every time anybody sends this person a
message, in every open tab. `unreadByConversation` is five queries for one
conversation or two hundred.
