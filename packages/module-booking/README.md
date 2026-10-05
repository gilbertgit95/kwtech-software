# @kwtech/module-booking

Bookings per workspace, as a sub-app on the Apps page: a customer reserves a
time for a service, with a member of staff, a place or a piece of equipment.
The partner of the walk-in queue: the queue serves people who turn up, booking
serves people who say when they will.

**Phases 1 and 3 of `docs/BOOKING-PLAN.md` are built.** Staff: services,
resources and their opening hours, the day as a list, bookings made, moved and
cancelled, live updates, and a reminder shortly before a booking starts.
Customers: a public page to ask for a booking with no account, and a manage
link to see where it stands, cancel it or move it. Not built yet: the day grid
(phase 2), messages to customers (4), the shared customer record (5), and the
hand-offs to the queue and the point of sale (6).

Generic on purpose (plan D1): services and resources, never a trade's words.

## In a Next.js app

```ts
// apps/web-app/src/modules.ts
import { bookingWebModule } from '@kwtech/module-booking/react';

const FEATURE_MODULES = [/* … */, bookingWebModule()];
```

No drawer entry: it declares one app (`key: 'booking'`, gated on
`booking:read`), which `module-app-hub` shows on the workspace's Apps page —
and two PUBLIC routes for customers, `/book/:linkId` and `/my-booking/:token`
(see "The public page").
`BookingApp` lays itself out by its box (container queries) and never
navigates: the section and the open booking are its own state.

Sections, each shown only to somebody holding its key (hiding is cosmetic; the
API authorises again):

| Section | Key | What it is |
|---|---|---|
| Requests | `booking:read` | every request from the public page still waiting, whatever its day, longest-waiting first, with a count on the bar. Shown once the public page is on. Confirm and Decline need `booking:manage_appointments` |
| Day | `booking:read` | one workspace day's bookings, a drawer per booking with its history; New booking, Move, Correct details, Mark arrived / done / no-show (`booking:manage_appointments`); Cancel (`booking:cancel_appointments`) |
| Services | `booking:manage_services` | name, length, buffers, an optional price, who performs it |
| Resources | `booking:manage_services` | staff, places, equipment; each one's week of opening hours; closed days |
| Settings | `booking:manage_settings` | how far apart the offered times are; the staff reminder; the public page: on or off, its name and note, the customer's rules, the link, its QR code, and replacing the link |

Every day and time on screen is the **workspace's** (`useWorkspaceTimeZone()`).

## In a NestJS app

```ts
bookingServerModule({
  prismaProvider, prismaWriteProvider,
  limitCheckerProvider,        // BOOKING_LIMIT_CHECKER
  workspaceTimeZoneProvider,   // BOOKING_WORKSPACE_TIME_ZONE
  memberDirectoryProvider,     // BOOKING_MEMBER_DIRECTORY
  notifierProvider,            // BOOKING_NOTIFIER
  pubsubProvider,              // BOOKING_PUBSUB
  resolveActorId: (request) => resolvePrincipal(request)?.userId,
});
```

| Port | Asks | Unbound means |
|---|---|---|
| `BOOKING_PRISMA`, `BOOKING_PRISMA_WRITE` | the structural client (`BookingTransaction`) | the module does not start |
| `BOOKING_LIMIT_CHECKER` | the plan's `booking:resources` | the DECLARED default (10), never unlimited |
| `BOOKING_WORKSPACE_TIME_ZONE` | the workspace's IANA zone | Asia/Manila, never UTC |
| `BOOKING_MEMBER_DIRECTORY` | who works the desk (`listDesk`: active members holding `booking:manage_appointments`), and names | no names, no member can be linked to a resource, no reminder reaches anyone |
| `BOOKING_NOTIFIER` | tell staff: a booking is about to start, a customer asked for one, cancelled theirs or moved it | nobody is told; requests still show as waiting |
| `BOOKING_PUBSUB` | the app's one engine | not live: changes show on the next read |

The keys, the cap and the process must also be on the module's line in the
app's `seed/registry.ts`. Without it every booking operation is reachable by
anybody signed in, and the reminders never run.

The ports the plan names for later (the customer directory and messenger, the
queue check-in, the point-of-sale hand-off) are not declared yet. The public
page needs no port: what a visitor sees of the shop is its own settings.

The app must also declare the notification sources its adapter sends under
(`booking.upcoming`, `booking.request`, `booking.customer`).

## Realtime

One trigger, `booking.changed`, for every workspace; `bookingEvents` filters
each subscriber to its own workspace. An event carries a kind (`appointment`,
`catalogue`, `settings`), an appointment id and who did it — never a
customer's name. `sync` is sent first and after every reconnect; the client
debounces and reads again.

## Vocabulary

- **Service**: what is booked. A length, an optional buffer before and after,
  an optional price (shown, never charged). Archived, never deleted.
- **Resource**: who or what is booked: `staff`, `place` or `equipment`. A staff
  resource may be linked to a member, who is then the one reminded.
- **Hours**: a resource's week, in stretches of **minutes of the workspace's
  day**. A booking must fit inside one stretch.
- **Exception**: a closed day, or a closed stretch of one, for one resource or
  for all of them.
- **Booking** (`BookingAppointment`): a service, with a resource, at an
  instant, for a customer whose name, phone and e-mail are copied onto it.
- **Blocked range**: the service's time plus its buffers, copied onto the
  booking. What every overlap check reads.
- **Change**: one row of a booking's history. Never updated or deleted.

Statuses: `pending` → `confirmed` → `arrived` → `done`, with `declined`,
`cancelled` and `no_show` as ends. A booking made by staff starts `confirmed`.
`pending` and `declined` are reached only from the public page: a booking a
customer asks for is `pending` until staff answer it, and holds its slot while
it waits. Nothing comes back from an end state (PLAN §12.97).

## The domain entry point

`@kwtech/module-booking` is pure: no Prisma, Nest or React.

| File | Decides |
|---|---|
| `domain/time.ts` | days, the workspace's day of an instant, `zonedInstant(day, minute, zone)`, parsing a start |
| `domain/hours.ts` | a valid week, a valid closure, `openWindows`, `fitsOpenWindows` |
| `domain/slots.ts` | which statuses hold a slot, the blocked range, overlap, `freeSlotStarts` |
| `domain/appointments.ts` | `nextBookingStatus`, when a booking may be moved or corrected, the customer's details, a reason |
| `domain/catalogue.ts` | a valid service, resource and settings, and their caps |
| `domain/public.ts` | the customer's rules: notice, horizon, cutoff, when a request lapses, how many may wait |
| `domain/reminders.ts` | who is told a booking is about to start |
| `domain/events.ts` | who hears a change |

## No double booking

Two bookings of one resource may not both hold a slot while their blocked
ranges share any time. Three things keep it, and they read the same rule:

1. **The write looks** for a clash inside its transaction (`takeSlot`), which
   gives the usual refusal its sentence.
2. **The database refuses** the row when two writes pass that look at once:
   the exclusion constraint `booking_appointment_no_overlap`, written by hand
   in the migration because Prisma cannot express it. It needs `btree_gist`.
   `isSlotConflict` turns its error into the same refusal.
3. **A move is checked like a new booking**, in the transaction that frees the
   old time. A refused move leaves the booking where it was.

⚠ The statuses in the constraint's `WHERE` are `BOOKING_HOLDING_STATUSES`
(`pending`, `confirmed`, `arrived`, `done`). Changing that list needs a new
migration that drops and re-adds the constraint.

Free times are never stored. `bookingSlots` computes them each time: hours,
minus closures, minus the bookings that hold a slot. The same function
(`openWindowsOn`) reads availability for the list and for the write, so what
is offered is what is accepted. Opening hours bind staff too.

## The public page

Off until a workspace turns it on in Settings, which needs a name to show.

| Address | Authority | Operations |
|---|---|---|
| `/book/:linkId` | the link id: random, handed out, NOT a secret. It names a shop whose page is on | `publicBookingPage`, `publicBookingSlots`, `requestPublicBooking` |
| `/my-booking/:token` | the manage token: 256 bits, ⚠ a secret, the customer's only credential | `publicBooking`, `publicBookingMoveSlots`, `cancelPublicBooking`, `reschedulePublicBooking` |

- **Its own resolver class** (`BookingPublicResolver`): every operation is
  marked public with a reason, none declares a workspace scope or is bound to
  a key, and those taking the token are credential surfaces — the host points
  its tightest rate limit at them.
- **A booking asked for here is a request** (plan D2): `pending`, holding its
  slot. The page says "Request this booking" and "We will confirm your
  booking", never "You are booked".
- **The token is returned once** and stored as its SHA-256
  (`manageTokenHash`). Nobody can show it again; a customer who loses it
  contacts the shop (PLAN §12.100). A host with a public snapshot must scrub
  that column.
- **One refusal.** An unknown link, a page turned off and a token nobody was
  given all answer `null`. A request the shop's set-up cannot take answers
  only "that time has just been taken".
- **What a visitor learns:** the title and note the shop wrote, its services,
  its resources' names and their free times. No ids of the workspace, and
  nothing about another customer.
- **The customer's rules** (settings; none binds staff): notice
  (`leadMinutes`, 60), horizon (`horizonDays`, 30), cancellation cutoff
  (`cutoffMinutes`, 120), how long a request waits (`lapseHours`, 24).
- **Abuse is bounded, not prevented** (PLAN §12.99): a phone or e-mail is
  required, one contact may have 3 requests waiting, a workspace 200.
- **A customer's move goes back to waiting** (plan D8), at the new time, with
  the old one given up. The page says so before the press. A move by staff
  leaves a confirmed booking confirmed.
- **The link** is made the first time the page is turned on, kept when it is
  turned off, and retired only by "Replace the link"
  (`resetBookingPublicLink`). Manage links are unaffected by either.
- **Time zone:** a visitor has no workspace, so the zone arrives with the
  page's data and is checked (`publicTimeZone`) before anything is printed.

## What changing the set-up does not do

Shorter hours, a closed day, an archived resource or a changed service length
change what is **offered from now on**. Bookings already made stay as they
are, and the desk moves or cancels each one (PLAN §12.96).

## What the app does not tell the customer

Nothing is sent to a customer (plan D3, PLAN §12.91). When staff move or
cancel a booking, the dialog says so, with the phone and e-mail in front of
the person doing it. A customer who asked on the public page finds out on
their manage link that they were confirmed, declined or lapsed.

## Dialogs keep what was typed

A booking dialog does not close on a press outside it, and refuses Escape
once anything in it has been typed or chosen (it says so). The Close button is
the way out. `test/web-module.test.ts` holds this by reading the component.

## Processes

| Key | Does | Default schedule | Limits |
|---|---|---|---|
| `booking.upcoming_sessions` | shortly before a confirmed booking starts, tells the member its staff resource is linked to, otherwise everybody who works the desk | every 5 minutes, everywhere | `interval` only, not under 5 minutes; 60 s a run; 500 bookings a run; looks back 60 minutes |

- How long before is each workspace's own setting (`reminderMinutes`, default
  15). 0 turns its reminders off.
- Idempotent by `booking_reminder`, keyed by booking and start, written before
  anybody is told. A moved booking is reminded of its new time.
- For this process "too late" means "already started": a booking that had
  started when a run first saw it is counted as skipped, never announced.
- It reaches only the workspaces of organizations whose plan includes
  `booking:read`.
- Paused, nobody is reminded; bookings still work, and the day list still
  shows them. Bookings that start while it is paused are counted as skipped
  when it resumes (those of the last hour).

| Key | Does | Default schedule | Limits |
|---|---|---|---|
| `booking.lapse_requests` | declines a request from the public page that nobody confirmed in time — after the workspace's `lapseHours`, or when its own time arrives — which frees its slot | every 5 minutes, everywhere | `interval` only, not under 5 minutes; 60 s a run; 500 requests a run |

- Idempotent by the booking's own row: a compare-and-set from `pending`, with
  its history row (`actorKind: system`, "Not confirmed in time").
- Nothing is too late to lapse, so `skippedLate` is always 0 and its
  `tooLateAfterMinutes` is declared only because the contract requires it.
- It tells nobody. Paused, requests keep their times until staff answer them.

## What it declares

- **Keys** (workspace level): `booking:read`, `booking:manage_appointments`,
  `booking:cancel_appointments` (privileged), `booking:manage_services`,
  `booking:manage_settings`.
- **Limit**: `booking:resources`, plan-sourced, counted per workspace over
  live resources, default 10. Restoring an archived resource is checked too.
- **Role presets** (data; the app decides who holds them):
  `booking-front-desk` (read, manage, cancel) and `booking-manager` (all five).
- **Models**: `BookingService`, `BookingResource`, `BookingServiceResource`,
  `BookingHours`, `BookingException`, `BookingAppointment`, `BookingChange`,
  `BookingReminder`, `BookingSettings` (`booking_*` tables).
- **Operations**: for staff, 8 queries, 16 mutations and 1 subscription; for
  customers, 4 queries and 3 mutations. All in `src/operations.ts`.
- **Routes**: `/book/:linkId` and `/my-booking/:token`, public and fullscreen.
- **Notification sources** (declared by the app): `booking.upcoming`,
  `booking.request`, `booking.customer`.
