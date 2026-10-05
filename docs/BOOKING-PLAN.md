# `module-booking` — plan

Status: **phases 1 (staff only) and 3 (the public link) are built, 2026-10-05**
— `packages/module-booking`, what it does and does not do in its README and in
PLAN §13. Phase 3 was built before phase 2 (the day grid) on the operator's
word; nothing in it depended on the grid. Phases 2, 4, 5 and 6 (§10) are not
started. What follows is the plan as it was written: the operator asked
which sub-apps the architecture could take next, had appointments expanded,
asked for the conversation to be kept here, and then said the module will be
planned. The operator's answers are in §8 (D1 to D8); no question is open.
The rest (the schema, the keys, the ports, the phases) is the proposal those
answers shaped, still to be reviewed before anything is built. Once it is built the decision goes to PLAN §13.

## 1. What it is

A customer reserves a time for a service, optionally with a specific staff
member. Staff see the day, confirm or move bookings, and mark people as
arrived, done or no-show. A public link lets a customer book without an
account.

A sub-app like the others: it lives under a workspace, its rows are keyed by
`workspaceId`, its keys are workspace level, and it is declared in `apps` on
the web descriptor so it appears on the workspace's Apps page. One workspace is
one place of business.

It is the partner of the walk-in queue (`module-queuing-window`): the queue
serves people who turn up, booking serves people who say when they will.

## 2. The pieces

1. **Services**: what can be booked. A duration, an optional price, and an
   optional buffer before or after. Archived, never deleted.
2. **Resources**: who or what is booked: a staff member, a place (a counter, a
   chair, a room) or a piece of equipment (a printer, a machine). A service
   lists the resources that can perform it.
3. **Availability**: weekly opening hours per resource, and exceptions (a day
   off, a holiday, a blocked hour).
4. **Bookings**: the reservation, with a free-text note for what the customer
   needs. Status `pending`, `confirmed`, `declined`, `arrived`, `done`,
   `cancelled` or `no_show`. A booking made on the public link starts
   `pending` and staff confirm or decline it (D2); one made by staff is
   `confirmed` as it is made (D6).
5. **Cancelling and rescheduling** (D7), by staff and by the customer on
   their manage link. A rescheduled booking is the SAME booking at a new time,
   not a cancellation and a new one, so its history stays in one place.
6. **Slots are never stored.** They are computed from availability minus the
   bookings already made, so there is one source of truth and nothing to keep
   in step.

## 3. The rules to keep from day one

- **⚠ No double booking.** Two people choosing the same slot at once must not
  both succeed. The write checks for an overlap inside its transaction, and the
  database enforces it as well (principle 6: make the wrong state
  unrepresentable, rather than forbidden in a comment).
- **Every day and time is the WORKSPACE's.** Opening hours are minutes of the
  store's day, bookings are instants, and "today's bookings" is the store's
  today (`.claude/rules/typescript.md`, "Days, times and time zones"). A booking
  made at 11 PM in Manila must land on that day: the tests cross that boundary,
  as the point of sale's do.
- **⚠ A pending booking holds its slot.** A public booking waits for staff
  (D2), and while it waits nobody else can take that time: were the slot left
  free, two customers could both be waiting on a confirmation only one can
  get. Declining it frees the slot.
- **Nothing is deleted, and every change is kept (D7).** A cancelled booking
  stays, with who cancelled it, when and why. A reschedule records the time it
  moved from. Somebody asking "who moved Maria's booking?" has an answer.
- **⚠ A reschedule is checked like a new booking.** The new time goes through
  the same overlap check, in the same transaction that frees the old one, so
  moving a booking can never double-book and never leaves it with no slot.
- **Generic, in its words and its fields (D1).** Services and resources, never
  "stylist" or "printer" in the schema or the copy. What a business needs said
  about a booking goes in its note, not in a field only one trade has.
- **One resource per booking, to start.** A booking that needs both a person
  and a room is a much harder schedule.
- **The module owns no identity and no customer LIST.** A staff resource
  holds a bare `userId`. The customer's name, phone and e-mail are copied onto
  the booking, with a nullable `customerId` beside them for the shared customer
  record the operator wants (D5). That record belongs to a customer management
  module still to be built, not to booking and not to the point of sale: the
  copy on the booking is what was true when it was made, as an order's lines
  copy the item.

## 4. Schema (`prisma/booking.prisma`)

All `Booking*` models and `booking_*` tables.

| Model | Holds |
|---|---|
| `BookingService` | name, duration in minutes, buffers, price, archived flag |
| `BookingResource` | name, kind (`staff`, `place` or `equipment`), an optional bare `userId` |
| `BookingServiceResource` | which resources can perform which service |
| `BookingHours` | weekday, start and end minute of the day, per resource |
| `BookingException` | a day or a time range a resource is closed |
| `BookingAppointment` | service, resource, start and end instants, the customer's name, phone and e-mail (separate fields, so a message can be addressed to either later, D3), a nullable bare `customerId` for the shared record (D5), a note, status, who confirmed or declined it and when, a manage token |
| `BookingChange` | one row per change to a booking (D7): what (`created`, `confirmed`, `declined`, `rescheduled`, `cancelled`), by whom (a staff `userId`, or the customer through the manage link), when, the times it moved from and to, and the reason |
| `BookingSettings` | lead time, how far ahead people can book, the cancellation cutoff. No "needs confirming" switch: a public booking always does (D2) |

## 5. Keys (all workspace level)

| Key | May |
|---|---|
| `booking:read` | see the day and the bookings |
| `booking:manage_appointments` | create, reschedule, confirm or decline, mark arrived or done |
| `booking:cancel_appointments` | cancel, with a reason. Its own key: cancelling is the higher-risk act |
| `booking:manage_services` | services, resources and hours |
| `booking:manage_settings` | the rules and the public link |

Role presets: a front desk (read, manage, cancel) and a manager (everything).
A member holds one workspace role, so somebody who also works the till or the
queue needs a combined role (`.claude/rules/database.md`, "Combined workspace
roles"). A plan limit on resources per workspace is the natural cap.

## 6. The public booking page

The part that needs the most care.

- A public surface, so it carries `PUBLIC_SURFACE_METADATA` with a reason, as
  the queue's TV display does.
- The customer gets a **manage link** with a token, to move or cancel their
  booking. That token is a secret somebody could guess, so those operations
  also carry `CREDENTIAL_SURFACE_METADATA` and get the tight throttle.
- It shows free slots only, never who holds the taken ones.
- **The manage link cancels and reschedules** (D7), up to the cancellation
  cutoff in the settings; past the cutoff, the page says to contact the shop.
  The cutoff binds the customer, not staff. A reschedule there is a new
  request (D8): the page warns that the current time is given up and the new
  one waits for the shop. Staff are told of either (`BOOKING_NOTIFIER`).
- **A booking made here is a request** (D2). The page says so: "We will
  confirm your booking", never "You are booked". The manage link shows whether
  it is still waiting, confirmed or declined, and until customer messages
  exist (D3) that page is the only place the app tells the customer.
- The visitor has no session, so the workspace's time zone comes from the
  server with the page's data and is checked with `isValidTimeZone` before use.

## 7. Ports

| Port | Asks | Unbound means |
|---|---|---|
| `BOOKING_WORKSPACE_TIME_ZONE` | the store's zone | Asia/Manila, never UTC |
| `BOOKING_MEMBER_DIRECTORY` | names for staff resources | no names are shown |
| `BOOKING_NOTIFIER` | tell staff: a booking is waiting to be confirmed, a customer cancelled or rescheduled, one is starting soon | nobody is told |
| `BOOKING_CUSTOMER_DIRECTORY` (later, D5) | find or save a customer in the shared record, and link the booking to it | bookings keep only their own copy of the name, phone and e-mail, which is how it ships |
| `BOOKING_CUSTOMER_MESSENGER` (later, D3) | send the customer an e-mail or an SMS: received, confirmed, declined, a reminder | nothing is sent, which is how it ships |
| `BOOKING_QUEUE_CHECK_IN` (later) | an arrived booking becomes a queue ticket | arrivals stay in the booking list |
| `BOOKING_POS_HANDOFF` (later) | a finished booking opens an order at the till | no order is opened |

## 8. Decisions

### Decided (operator, 2026-10-05)

| # | Question | Decision |
|---|---|---|
| D1 | Which businesses it is for | **A print shop first, built generic.** It will be used by other kinds of business, so nothing in the schema, the keys or the copy names a trade: services, resources (staff, place, equipment) and a note on the booking. A print shop's defaults (what its services and resources are called) are data the shop enters, not code |
| D2 | Whether a public booking needs confirming | **It does, always.** A booking made on the public link is `pending` until staff confirm or decline it, and it holds its slot while it waits (§3). Staff are told one is waiting (`BOOKING_NOTIFIER`). There is no setting to turn confirming off |
| D3 | Reminders and messages to customers | **Left out for now, and planned for.** Nothing is sent to a customer in the first version. The operator will set up an e-mail provider later and may set up SMS providers too, so the module is shaped for it from the start: a port (`BOOKING_CUSTOMER_MESSENGER`, §7) that sends nothing while unbound, and the customer's phone and e-mail kept as separate fields (§4). The gap is PLAN §12.91 |
| D4 | Deposits | **None at first.** No money is taken when booking. It would tie the module to the point of sale or to a payment provider before the booking itself is proven |
| D5 | Who the customer is | **One customer record, shared across the apps, is what the operator wants — and it will come from a customer management module built later** (the operator's "CMS"; corrected the same day, after it was first recorded here as "the booking keeps its own"). Until that module exists, the booking carries the customer's name, phone and e-mail itself. It is shaped to join the shared record without a migration of meaning: a nullable bare `customerId` (no foreign key, as every cross-module id) and a port, `BOOKING_CUSTOMER_DIRECTORY` (§7). Booking does not read the point of sale's `PosCustomer`: modules never import each other, and a second private list would be one more to merge later. The gap is PLAN §12.92 |
| D6 | A booking made by staff | **Confirmed as it is made.** The person making it is the one who would confirm it; only a booking from the public link waits (D2) |
| D7 | Cancelling and rescheduling | **Both, from the start.** Staff cancel (with a reason, behind its own key) and reschedule; the customer does both from their manage link, up to the cancellation cutoff. A reschedule keeps the same booking and records where it moved from; nothing is deleted (§3, `BookingChange` in §4) |
| D8 | A customer's reschedule of a confirmed booking | **It needs confirming again.** The booking goes back to `pending` at the new time, holding the new slot and freeing the old one: a time the customer picked is a request until staff accept it (D2). The cost, accepted: if staff decline, the customer has lost the old time as well, so the manage link warns of it before the move. A reschedule by STAFF stays confirmed (D6) |

What D2 and D3 mean together: **the app cannot tell a customer their booking
was confirmed.** Until messages exist, the customer finds out on their manage
link, or the shop contacts them by the phone or e-mail they left. The public
page has to say that plainly.

What D7 and D3 mean together: **when STAFF cancel or move a booking, the app
cannot tell the customer either.** The screen says so at that moment, with the
customer's phone and e-mail in front of the person, so they make the call.

A pending booking nobody acts on keeps its slot: there is no scheduler in
`web-server` to expire it (PLAN §12.40). The planned background runner
(`docs/JOBS-PLAN.md`) is what would lapse it, and what would remind staff of
a session about to start; both are processes booking declares once that
runner exists. The day's list shows what is waiting,
oldest first, so it is not forgotten.

## 9. Booking first, a calendar later

Discussed 2026-10-05: whether to start with a calendar app or with booking.

- **The calendar is booking's main screen, not a separate app it depends on.**
  A day view with a column per resource, a week view for one resource, moving a
  booking by dragging it, and a plain list of the day for a phone.
- **`web-ui` has no calendar or time grid** as far as was checked in that
  conversation (its documented exports are the data grid, menus, dialogs, the
  list drawer and the like). The grid is new work, and the largest piece of UI
  in the module. Confirm against `packages/web-ui` before estimating.
- **Recommended: booking first.** It is useful the day it ships, while a
  general calendar with nothing feeding it is an empty grid. Building booking
  shows what the grid really needs; building the calendar first means guessing.
  A calendar module built first is extraction on speculation (principle 9).
- **The path:** booking with a list of the day; then the day grid inside
  booking; then, when shifts or task due dates want to appear on the same
  grid, a general calendar module fed by ports, and the grid moves to `web-ui`
  for its second consumer.
- **The case for the reverse:** if what people ask for is a shared schedule
  (events, shifts, reminders) and nobody reserves anything, the calendar is the
  product and booking is a feature on top of it later.
- **Outside calendars** (Google Calendar, invitations) need a provider and
  credentials: a later option, not the core.

## 10. Phases

1. **Staff only.** Services, resources, hours, the day as a list (the point of
   sale's period picker chooses the day), bookings made by staff (confirmed as
   made, D6), cancelling and rescheduling by staff (D7), live updates.
   This proves the model and the double-booking rule before the costly UI.
2. **The day grid**, and moving a booking on it.
3. **The public link.** A customer requests a booking, staff confirm or
   decline it, and the manage link shows where it stands and lets the customer
   cancel or reschedule (D7).
4. **Messages to customers** (D3), once an e-mail provider is set up, then
   SMS: received, confirmed, declined, a reminder before the time.
5. **The shared customer record** (D5), once the customer management module
   exists: bookings link to it through `BOOKING_CUSTOMER_DIRECTORY`.
6. **Handoffs.** The queue and the
   point-of-sale ports.

**Order against the background runner (operator, 2026-10-05): the runner
first.** `module-jobs` is built before this module's phase 1, with task due
reminders as its first process (`JOBS-PLAN.md` §9, D8). Reminding staff of a
session about to start, and lapsing a request nobody confirmed, are then
processes booking declares from its first phase, not gaps to return to.

## 11. The other sub-apps raised

From the same conversation, for when booking is settled. None is planned.

- **Inventory**: stock per item, stock in and out, low-stock alerts, stock
  takes. The point of sale has items and costs but no quantities; this was the
  other candidate for "next".
- **Expenses**: receipts, categories, approval, recurring bills, feeding the
  books as point-of-sale sales do.
- **Shifts and attendance**: clock in and out, schedules, hours per person,
  beside the sales the point of sale already credits "by staff".
- **Customers** (the operator's "CMS", 2026-10-05: to be built, not yet
  planned): one customer record shared by the apps, with history and
  follow-ups. Booking (D5) and the point of sale would both reach it through
  ports; the point of sale's own `PosCustomer` rows would move into it.
- **Invoices and quotes**: sales that are not counter sales.
- **Job orders**: a job from intake to release, for a print, repair or laundry
  shop.
- **Payroll**: after attendance. Higher risk; split its keys carefully.
- **Loyalty**: points or stamps, redeemed at the till through a port.
- **Smaller**: forms and checklists, a notice board, a shared file shelf (needs
  a storage decision), a public feedback link.

Two things hold for all of them: every new sub-app adds role presets and so
more combined roles in `app-roles.ts`, and every link between two sub-apps is a
port the app wires, never an import between modules, so the direction of each
link is decided up front.
