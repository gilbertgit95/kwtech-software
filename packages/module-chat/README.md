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
| `notifierProvider` | **nobody is told unless their tab is open** — see below |

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

## Emoji — a picker, and a one-tap button

Emoji always worked: they are Unicode text in a normal textarea, which is why
no schema and no server change was ever needed. What was missing was a shortcut
to the common ones.

⚠ **No library.** Every npm picker ships the full Unicode set with names,
keywords and usually sprite sheets — 200KB to over 1MB hanging off a text box.
This is **160 curated emoji in four groups, under 1KB of plain strings**, plus a
recents row. What it gives up: the complete catalogue, search by name, and
flags. What it does not give up is access to anything else — **the OS picker
still works**, and this is a shortcut rather than the only way in.

⚠ **Insertion is at the CARET, replacing a selection.** A naive picker appends
to the end, which moves somebody's cursor without asking every time they pick
one mid-sentence. `insertEmoji` is pure and tested; the caret is measured in
UTF-16 units because that is what `selectionStart` speaks — mixing that with
code points is how an emoji lands inside a previous one.

⚠ The picker's buttons use `onMouseDown` with `preventDefault`, not `onClick`.
A click moves focus to the button, which blurs the textarea, and a blurred
textarea reports a selection of 0 — so the emoji would land at the start of the
message rather than at the caret.

### The quick button

One tap sends a single emoji. ⚠ It **does not touch what is in the box**: the
quick button is a reply, not a shortcut for typing one, and appending to a
half-written message and sending that would destroy the draft.

**It is configured in two places, and the second is the important one:**

| Where | What it sets |
|---|---|
| `/chat/preferences` | your DEFAULT, used wherever a conversation has no opinion |
| a conversation's own settings → *Your quick emoji here* | this ONE conversation's button |

⚠ **Including direct messages, which get their OWN layout.** A DM has no group
settings — it cannot be renamed (it is named by who is in it), take a third
person, or be archived or left — so its settings page is a short page of its
own rather than the group one with holes cut in it. What it does have is this
section, because the quick emoji belongs to the VIEWER rather than to the
conversation.

⚠ **`QuickEmojiSection` is a shared component, outside every role check.** A
member has exactly as much right to it as an owner, and a DM has no roles at
all — so it cannot live inside the group page's markup. It did at first, which
is how it came to be unreachable in every DM: that page returned early with "a
direct conversation has no settings", a sentence that was true until this
section existed.

⚠ Both screens choose from **the whole catalogue**, the same one the composer
offers — not a shortlist. They briefly offered ten, which meant one screen let
you choose from 160 emoji and another from 10 for the same choice.

⚠ A thumbs-up is right for a standup group and wrong for the one conversation
where somebody always replies ❤️ or 👀. So the button is chosen where it is
USED, and the default is only the fallback.

⚠ **Per device and per person by construction.** It is `localStorage`, so it is
never sent anywhere — two people in one group can have entirely different
buttons and neither can see the other's. That also means the per-conversation
control is **not role-gated**: a member has exactly as much right to it as an
owner, so it sits outside every `canManage` block on that page.

⚠ **Three states, not two.** *Use my default* FORGETS the override, so the
conversation follows whatever the default becomes later; *No button here* is a
choice to have none in this thread specifically — which somebody may want in
exactly the conversation where a stray tap would be worst. `resolveQuickEmoji`
is the one place that order is written down.

⚠ The override map is **capped**: nothing ever deletes an entry — a
conversation can be archived, left, or never opened again and its id lingers —
so without a bound it is a store that only grows on a device nobody clears.
Past the cap the oldest is dropped, and that conversation falls back to the
default, which is what it had before anybody chose. ⚠ It defaults to
👍 and is ON, which points the opposite way to the tone default — deliberately.
A sound plays without being asked for in a room that may have other people in
it, so silence is polite; a button sits there doing nothing until pressed, and
defaulting it to absent would hide the feature from everybody who never opens
preferences.

⚠ **The stored value is validated, and this is the one that matters**: it comes
out of `localStorage`, which a person can edit by hand, and one tap SENDS it.
Without a cap a hand-edited entry is an arbitrary message body one tap away.

## The tone, and the settings that are not on the server

A short sound when a message arrives — and **the whole of what `dnd` can
honestly claim** until a notification system exists. Availability ships as a
coloured dot, and a dot that lies is worse than no dot.

**The rule lives in `shouldPlayTone`**, in the domain, because each of its four
refusals is a complaint somebody would otherwise make:

| Silent when | Because |
|---|---|
| the setting is off | somebody asked for silence |
| it is your own message | ⚠ otherwise it beeps when you press send, in every open tab |
| it is a system message | "X left" is addressed to nobody — the same rule keeps it out of the unread count |
| the conversation is open **and** the window focused | it would beep at you while you watch it arrive |
| availability is `dnd` | §12.44 |

⚠ **Both halves of the fourth are required.** An open thread in a BACKGROUND
tab must still sound: you are not looking at it, which is exactly when being
told matters.

### ⚠ The preview button is the unlock, not a nicety

Browsers refuse to start audio until the page has been interacted with, and a
tone played into a context that was never unlocked is dropped **silently** — no
error, nothing in the console worth reading, just a chat that never makes a
sound. Pressing Play on `/chat/preferences` is a real user gesture, so it is
what switches the feature on for real.

### Synthesised, not fetched

No audio file ships. The ten tones are built from an oscillator, described in
`chat-tone.ts` as a few notes each — a note being a pitch, a duration, an
optional SWEEP to a second pitch, a waveform and an envelope. ⚠ The sweep is
what makes a pop a pop: pitch rising fast through a short decay is what the ear
reads as something bursting, and a steady tone of the same length is a beep.

⚠ **Named for what they sound like, never for a product.** "Pop", "Ding",
"Ping" — not the name of any messenger that has one. A real product's
notification sound is a recorded asset somebody owns, so these are original
sounds in a familiar genre; and a tone named after another app sets an
expectation this cannot meet, which reads as a bad copy rather than its own
sound. A test fails on a brand name in the catalogue. A file has to arrive before it can
play — so the first message after a load would race the download, and the fix
is preloading every tone on every page. ⚠ What this gives up: a designer cannot
replace a sound without writing code. If that becomes the point, `play` takes a
URL and the catalogue grows a `src`; the seam is one function wide.

### Stored per DEVICE

`localStorage`, under `kwtech_chat_settings`, holding `{ enabled, tone }`. Not
the database, and that is the honest scope: somebody muting chat at a shared
desk means *here*, not on their phone.

⚠ The two values are kept apart rather than collapsed into a tone called "off",
so muting and unmuting gives you back the sound you chose. ⚠ Every read
validates — storage that throws, unparseable JSON, the wrong shape, a tone this
build no longer ships — because every one of those failures otherwise lands at
the moment a message arrives.

⚠ The default tone is **Bubble** — the sound people already read as "a
message", so it needs no explanation. ⚠ Changing the default moves nobody who
has chosen: the stored value wins, and the default is consulted only when there
is none.

⚠ Sound is **off by default**. Chat is one page inside a back-office
application, and a tab that starts making noise because somebody navigated to
the product is a setting people hunt for angrily rather than discover.

## Controls follow the rules the server enforces

Every role-gated control in the UI calls the **same domain function the server
enforces with** — imported, never restated:

| Control | Rule | Who |
|---|---|---|
| New conversation | `chat:start` (a feature key) | anyone holding it |
| Add someone | `canInviteToConversation` | owner, admin |
| Rename, roles, remove | `canManageConversation` and the refusal helpers | owner, admin |
| Archive | `canArchiveConversation` | owner only |
| Delete a message | authorship | its author |
| Leave | — | anyone; withholding it would be a lockout |

⚠ **Hidden, not disabled.** A greyed-out control raises a question the screen
cannot answer — a member has no way to discover that inviting is an
owner-or-admin power, so a disabled button reads as a bug rather than a rule.

⚠ **Hiding is not enforcing**, and the direction of failure is the point:
because these are the server's own functions, the worst a mistake here can do is
HIDE a control the API would have allowed. It can never show one the API
refuses. The mutation is authorised again at the API regardless, and an app with
no permission model at all sees an empty list of held features — which hides
controls rather than revealing them.

Use `viewerAuthority(conversation)` to ask what the viewer may do; it narrows
the wire shape into what the rules accept, and an unknown role falls back to
`member`.

## Being told with the tab closed

The tone only plays in an open tab, which satisfies "people are told on time"
only for somebody already looking. So a message that lands for somebody with no
live socket produces a notification.

**Three pieces, and the split is the point:**

| Piece | Where | Knows about |
|---|---|---|
| `shouldNotify` | the domain | chat — pure, seven refusals, no transport |
| `ChatNotifier` | the module | ids and a group flag |
| the adapter | **the app** | email, push, whatever reaches a person |

⚠ **The port carries no message text and no group title.** The notification
says *who* wrote and links to chat. An inbox is a copy of the conversation
outside anything `canAccessConversation` can reach — in a mail provider's logs,
on a lock screen, outliving the account. The body is not passed rather than
passed-and-ignored, so a template cannot start including it by accident.

⚠ **Which is what keeps Web Push cheap.** The port is transport-blind: a push
implementation replaces the app's provider and changes nothing here.

### The seven refusals

Each is a notification somebody would otherwise have received and been annoyed
by — which is the failure mode that gets the whole system switched off, after
which nobody is told anything.

your own · a system message · not an active participant · **online**, because the
badge already moved and the tone already played · **`dnd`** · **muted** · **inside
the cooldown**.

⚠ `dnd` suppresses DELIVERY here, not presentation — it means no tone *and* no
mail. `mutedUntil` is load-bearing for the same reason.

### The cooldown is a column

`ChatParticipant.lastNotifiedAt`, fifteen minutes, per person per conversation.
A burst is one conversation, not ten things worth telling somebody about
separately. ⚠ A column rather than a map in memory: a restart would re-notify
everybody mid-conversation, and two replicas would each keep their own idea of
who had been told. ⚠ Stamped BEFORE sending, so a slow transport cannot let a
second message read a stale mark.

⚠ **It cannot break a send.** The message is committed and already on every
open socket by the time the notifier runs; a mail server that is down must not
turn a delivered message into a failed send.

## What an invited person sees

The **first** `kind: user` message of the conversation, and never the thread.
An invitation used to show who sent it and nothing else, which made
accept-or-decline close to a coin flip.

⚠ **`canAccessConversation` is NOT widened for this.** It stays ACTIVE ONLY.
The preview is a separate narrow read with its own name, so an audit of "who can
see message content" finds two call sites rather than one helper that quietly
means two things.

⚠ **It does not leak differently for a blocked sender**, which it achieves by
containing no block check at all — a preview absent for a blocked inviter and
present otherwise would answer "has this person blocked you" to anybody who
could get themselves invited. A test asserts the two cases are identical.

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
