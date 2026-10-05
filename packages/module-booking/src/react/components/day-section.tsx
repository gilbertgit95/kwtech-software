'use client';

import { cn, LIST_ITEM, LIST_KEYS, ListDrawer, listNeighbours } from '@kwtech/web-ui/react';
import {
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  type LucideIcon,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  StickyNote,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
import { addBookingDays, prepareBookingDay, workspaceBookingDay } from '../../domain/time.js';
import type { BookingAppointmentView } from '../booking-client.js';
import type { BookingAppState } from '../booking-state.js';
import { useBookingAction, useBookingData } from '../use-booking-data.js';
import {
  bookingActions,
  changeActor,
  changeText,
  customerInitials,
  dayStats,
  isSettled,
  statusChip,
} from '../view/day.js';
import { clockTime, dayAndTime, dayLabel, dayText, weekStrip } from '../view/time.js';
import { EditDetailsDialog, EndBookingDialog, NewBookingDialog, RescheduleDialog } from './booking-dialogs.js';
import { buttonClass } from './controls.js';
import { Alert, Empty, EmptyState, StatTile, StatusChip, TONE_MARK_CLASS } from './layout.js';

/** Which dialog is open over a booking. `new` belongs to the day list alone. */
export type BookingDialog = 'new' | 'move' | 'cancel' | 'decline' | 'details' | null;
type Dialog = BookingDialog;

/**
 * The day (BOOKING-PLAN §10, phase 1): one WORKSPACE day's bookings as a list,
 * in order, and the one opened from it in a drawer.
 *
 * - Every booking of the day is listed, whatever became of it: a cancelled one
 *   stays where it was, drawn quietly (D7).
 * - "Today" is the workspace's, and every time is printed in its zone.
 * - Kept fresh by `bookingEvents`: a booking made at another desk appears here.
 */
export function DaySection({ state }: { state: BookingAppState }) {
  const { client, scope, timeZone, can } = state;
  const today = workspaceBookingDay(new Date(), timeZone);
  const [day, setDay] = useState(today);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const loadDay = useCallback(() => client.day(scope, day), [client, scope, day]);
  const list = useBookingData(scope, loadDay, ['appointment', 'catalogue'], 'Could not load the day’s bookings.');
  const bookings = list.data?.appointments ?? [];
  const around = listNeighbours(
    bookings.map((booking) => booking.id),
    selected,
  );
  const stats = dayStats(bookings);

  const go = (next: string) => {
    setDay(next);
    setSelected(null);
  };
  const newBooking = can.manageAppointments ? (
    <button type="button" className={buttonClass('primary')} onClick={() => setDialog('new')}>
      <Plus aria-hidden="true" className="size-4" />
      New booking
    </button>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Alert message={list.error} />
      <ListDrawer
        label="booking"
        onClose={() => setSelected(null)}
        step={{
          onPrevious: around.previous ? () => setSelected(around.previous) : null,
          onNext: around.next ? () => setSelected(around.next) : null,
          position: around.position,
        }}
        list={
          <>
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex min-w-0 flex-col">
                <h2 className="truncate text-lg font-semibold tracking-tight">{dayLabel(day, today)}</h2>
                <p className="truncate text-sm text-muted-foreground">{dayText(day)}</p>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <DayPicker day={day} today={today} onDay={go} />
                {newBooking}
              </div>
            </header>

            <WeekStrip day={day} today={today} onDay={go} />

            <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
              <StatTile label="Still to come" value={stats.upcoming} />
              <StatTile label="Waiting to be confirmed" value={stats.waiting} tone="warning" />
              <StatTile label="Here now" value={stats.arrived} tone="success" />
              <StatTile label="Done" value={stats.done} />
            </div>

            {list.data?.truncated ? (
              <p role="status" className="text-xs text-muted-foreground">
                This day has more bookings than one list shows. The earliest are here.
              </p>
            ) : null}
            {list.data === null && !list.error ? <Empty>Loading the day…</Empty> : null}
            {list.data !== null && bookings.length === 0 ? (
              <EmptyState
                icon={CalendarPlus}
                title={`Nothing is booked for ${dayLabel(day, today).toLowerCase()}`}
                action={newBooking}
              >
                {can.manageAppointments
                  ? 'Take a booking for a customer, and it shows here at its time.'
                  : 'You can see bookings here, but not make them.'}
              </EmptyState>
            ) : null}
            <ul className="m-0 flex min-h-0 list-none flex-col gap-2 overflow-y-auto p-0 pb-1" {...LIST_KEYS}>
              {bookings.map((booking) => (
                <li key={booking.id}>
                  <BookingRow
                    booking={booking}
                    timeZone={timeZone}
                    selected={booking.id === selected}
                    onOpen={() => setSelected(booking.id)}
                  />
                </li>
              ))}
            </ul>
          </>
        }
        detail={
          selected ? (
            <BookingDetail
              // Remounted per booking, so one booking's dialog never opens over another.
              key={selected}
              state={state}
              appointmentId={selected}
              dialog={dialog}
              onDialog={setDialog}
              onChanged={list.reload}
            />
          ) : null
        }
      />
      {dialog === 'new' ? (
        <NewBookingDialog
          state={state}
          day={day}
          onClose={() => setDialog(null)}
          onSaved={(booking) => {
            setDialog(null);
            // Show the day the booking landed on, with it open: the proof it was made.
            go(workspaceBookingDay(new Date(booking.startsAt), timeZone));
            setSelected(booking.id);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Stepping through days: the arrows, a date field for any day at all, and a
 * way back to today.
 *
 * One DAY, where the point of sale's picker chooses a period: a booking list
 * is a day's work, and a range of them is the grid that comes next
 * (BOOKING-PLAN §10, phase 2).
 */
function DayPicker({ day, today, onDay }: { day: string; today: string; onDay: (day: string) => void }) {
  const step = cn(buttonClass('ghost'), 'w-10 px-0');
  return (
    <div className="flex items-center rounded-lg border border-border bg-card shadow-xs">
      <button
        type="button"
        aria-label="Previous day"
        className={cn(step, 'rounded-r-none')}
        onClick={() => onDay(addBookingDays(day, -1))}
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </button>
      <label className="flex items-center gap-2 border-x border-border px-2.5">
        <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-primary" />
        <span className="sr-only">Go to a day</span>
        <input
          type="date"
          className="h-10 min-w-0 bg-transparent text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={day}
          onChange={(event) => {
            // Cleared, or half typed: the day showing stays until there is a real one.
            if ('day' in prepareBookingDay(event.target.value)) onDay(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        aria-label="Next day"
        className={cn(step, day === today ? 'rounded-l-none' : 'rounded-none')}
        onClick={() => onDay(addBookingDays(day, 1))}
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
      {day === today ? null : (
        <button
          type="button"
          className={cn(buttonClass('ghost'), 'rounded-l-none border-l border-border px-3')}
          onClick={() => onDay(today)}
        >
          Today
        </button>
      )}
    </div>
  );
}

/** The week the day is in, a press away: seven days, the chosen one filled and today marked. */
function WeekStrip({ day, today, onDay }: { day: string; today: string; onDay: (day: string) => void }) {
  return (
    <fieldset className="m-0 grid grid-cols-7 gap-1 rounded-xl border-0 bg-muted/60 p-1">
      <legend className="sr-only">This week</legend>
      {weekStrip(day, today).map((entry) => (
        <button
          key={entry.day}
          type="button"
          aria-pressed={entry.isSelected}
          aria-label={dayText(entry.day)}
          className={cn(
            'flex min-w-0 flex-col items-center rounded-lg py-1.5 text-xs transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            entry.isSelected
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-background hover:text-foreground',
          )}
          onClick={() => onDay(entry.day)}
        >
          <span>{entry.weekday}</span>
          <span className={cn('text-base font-semibold tabular-nums', entry.isSelected ? null : 'text-foreground')}>
            {entry.dayOfMonth}
          </span>
          {/* Today keeps a mark even when another day is chosen, so the way back is always in sight. */}
          <span aria-hidden="true" className={cn('mt-0.5 size-1 rounded-full', todayMarkClass(entry))} />
        </button>
      ))}
    </fieldset>
  );
}

/** The dot under today: filled against whatever is behind it, and invisible under every other day. */
function todayMarkClass(entry: { isToday: boolean; isSelected: boolean }): string {
  if (!entry.isToday) return 'bg-transparent';
  return entry.isSelected ? 'bg-primary-foreground' : 'bg-primary';
}

/** A customer's initials in a disc: something to find a row by before reading it. */
export function Avatar({ name, quiet = false, large = false }: { name: string; quiet?: boolean; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold',
        large ? 'size-12 text-base' : 'size-9 text-xs',
        quiet ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
      )}
    >
      {customerInitials(name)}
    </span>
  );
}

function BookingRow({
  booking,
  timeZone,
  selected,
  onOpen,
}: {
  booking: BookingAppointmentView;
  timeZone: string;
  selected: boolean;
  onOpen: () => void;
}) {
  const chip = statusChip(booking.status);
  const settled = isSettled(booking.status);
  return (
    <button
      type="button"
      {...LIST_ITEM}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        // ⚠ `relative`: the bar down the edge and any `sr-only` text are positioned against the row, so they scroll with it.
        'relative flex w-full items-center gap-3 overflow-hidden rounded-xl border bg-card py-2.5 pr-3 pl-4 text-left shadow-xs transition-colors hover:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-accent ring-1 ring-primary' : 'border-border',
      )}
      onClick={onOpen}
    >
      {/* The status again, as a bar: a day is scanned down its left edge. */}
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', TONE_MARK_CLASS[chip.tone])} />
      <span className={cn('flex w-[4.5rem] shrink-0 flex-col', settled ? 'opacity-60' : null)}>
        <span className="text-sm font-semibold tabular-nums">{clockTime(booking.startsAt, timeZone)}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{clockTime(booking.endsAt, timeZone)}</span>
      </span>
      <span className={cn('flex min-w-0 flex-1 items-center gap-3', settled ? 'opacity-60' : null)}>
        <Avatar name={booking.customerName} quiet={settled} />
        <span className="flex min-w-0 flex-col">
          <span className={cn('truncate text-sm font-medium', booking.status === 'cancelled' ? 'line-through' : null)}>
            {booking.customerName}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {booking.serviceName} · {booking.resourceName}
          </span>
        </span>
      </span>
      <span className="hidden @md:block">
        <StatusChip label={chip.label} tone={chip.tone} />
      </span>
      {/* Narrow, the pill does not fit beside the name; the bar still shows the status, and this says it. */}
      <span className="sr-only @md:hidden">{chip.label}</span>
    </button>
  );
}

/** One fact about a booking, with the icon that says which. */
function Fact({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-start gap-2.5 text-sm">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/**
 * One booking, opened: who and when, what can be done with it, and everything
 * that has been. Shared with the Requests list, which opens the same drawer.
 */
export function BookingDetail({
  state,
  appointmentId,
  dialog,
  onDialog,
  onChanged,
}: {
  state: BookingAppState;
  appointmentId: string;
  dialog: Dialog;
  onDialog: (dialog: Dialog) => void;
  onChanged: () => Promise<void>;
}) {
  const { client, scope, timeZone, can } = state;
  const load = useCallback(() => client.appointment(scope, appointmentId), [client, scope, appointmentId]);
  const detail = useBookingData(scope, load, ['appointment'], 'Could not load the booking.');
  const action = useBookingAction('Could not change the booking.');
  const booking = detail.data;

  if (detail.error) return <Alert message={detail.error} />;
  if (detail.loading && booking === null) return <Empty>Loading the booking…</Empty>;
  if (booking === null) return <Empty>That booking is not here any more.</Empty>;

  const chip = statusChip(booking.status);
  const actions = bookingActions(
    booking,
    { manage: can.manageAppointments, cancel: can.cancelAppointments },
    new Date(),
  );
  const refresh = async () => {
    onDialog(null);
    await Promise.all([detail.reload(), onChanged()]);
  };
  const run = async (act: () => Promise<unknown>) => {
    if (await action.run(act)) await refresh();
  };
  // The step most likely next is the one drawn as the main button; the rest sit beside it, quieter.
  const steps = actions.confirm || actions.arrive || actions.finish || actions.noShow;
  const changes = actions.reschedule || actions.editDetails || actions.decline || actions.cancel;

  return (
    <article className="flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <Avatar name={booking.customerName} large />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-lg font-semibold tracking-tight">{booking.customerName}</h2>
          <div>
            <StatusChip label={chip.label} tone={chip.tone} />
          </div>
        </div>
      </header>

      <Alert message={action.error} onDismiss={action.dismissError} />

      <section className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5" aria-label="Booking">
        <Fact icon={Clock}>
          <span className="font-medium">
            {dayAndTime(booking.startsAt, timeZone)} – {clockTime(booking.endsAt, timeZone)}
          </span>
        </Fact>
        <Fact icon={MapPin}>
          {booking.serviceName} <span className="text-muted-foreground">with</span> {booking.resourceName}
        </Fact>
        {booking.customerPhone ? (
          <Fact icon={Phone}>
            <a className="text-primary hover:underline" href={`tel:${booking.customerPhone}`}>
              {booking.customerPhone}
            </a>
          </Fact>
        ) : null}
        {booking.customerEmail ? (
          <Fact icon={Mail}>
            <a className="break-all text-primary hover:underline" href={`mailto:${booking.customerEmail}`}>
              {booking.customerEmail}
            </a>
          </Fact>
        ) : null}
        {!booking.customerPhone && !booking.customerEmail ? (
          <Fact icon={Phone}>
            <span className="text-muted-foreground">No phone or e-mail was left.</span>
          </Fact>
        ) : null}
        {booking.note ? (
          <Fact icon={StickyNote}>
            <span className="whitespace-pre-wrap">{booking.note}</span>
          </Fact>
        ) : null}
      </section>

      {steps ? (
        <div className="grid grid-cols-2 gap-2">
          {actions.confirm ? (
            <button
              type="button"
              className={cn(buttonClass('primary'), 'col-span-2')}
              disabled={action.busy}
              onClick={() => run(() => client.confirm(scope, booking.id))}
            >
              <Check aria-hidden="true" className="size-4" />
              Confirm
            </button>
          ) : null}
          {actions.arrive ? (
            <button
              type="button"
              className={cn(buttonClass('primary'), 'col-span-2')}
              disabled={action.busy}
              onClick={() => run(() => client.mark(scope, booking.id, 'arrived'))}
            >
              <UserCheck aria-hidden="true" className="size-4" />
              Mark arrived
            </button>
          ) : null}
          {actions.finish ? (
            <button
              type="button"
              className={cn(
                buttonClass(actions.arrive ? 'secondary' : 'primary'),
                actions.noShow ? null : 'col-span-2',
              )}
              disabled={action.busy}
              onClick={() => run(() => client.mark(scope, booking.id, 'done'))}
            >
              <Check aria-hidden="true" className="size-4" />
              Mark done
            </button>
          ) : null}
          {actions.noShow ? (
            <button
              type="button"
              className={buttonClass('secondary')}
              disabled={action.busy}
              onClick={() => run(() => client.mark(scope, booking.id, 'no_show'))}
            >
              <UserX aria-hidden="true" className="size-4" />
              No-show
            </button>
          ) : null}
        </div>
      ) : null}

      {changes ? (
        <div className="flex flex-wrap gap-2">
          {actions.reschedule ? (
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => onDialog('move')}>
              <CalendarClock aria-hidden="true" className="size-3.5" />
              Move
            </button>
          ) : null}
          {actions.editDetails ? (
            <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => onDialog('details')}>
              <Pencil aria-hidden="true" className="size-3.5" />
              Correct details
            </button>
          ) : null}
          {actions.decline ? (
            <button
              type="button"
              className={cn(
                buttonClass('ghost', 'sm'),
                'ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive',
              )}
              onClick={() => onDialog('decline')}
            >
              <X aria-hidden="true" className="size-3.5" />
              Decline
            </button>
          ) : null}
          {actions.cancel ? (
            <button
              type="button"
              className={cn(
                buttonClass('ghost', 'sm'),
                'text-destructive hover:bg-destructive/10 hover:text-destructive',
                actions.decline ? null : 'ml-auto',
              )}
              onClick={() => onDialog('cancel')}
            >
              <X aria-hidden="true" className="size-3.5" />
              Cancel booking
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="flex flex-col gap-3" aria-label="History">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">History</h3>
        <ol className="m-0 flex list-none flex-col p-0">
          {booking.changes.map((change, index) => (
            <li key={change.id} className="relative flex gap-3 pb-4 last:pb-0">
              {/* The line joining one entry to the next; the last entry has nothing below it. */}
              {index < booking.changes.length - 1 ? (
                <span aria-hidden="true" className="absolute top-3 bottom-0 left-[5px] w-px bg-border" />
              ) : null}
              <span
                aria-hidden="true"
                className="relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-primary bg-card"
              />
              <span className="flex min-w-0 flex-col text-sm">
                <span>
                  <span className="font-medium">{changeText(change.kind)}</span>{' '}
                  <span className="text-muted-foreground">by {changeActor(change)}</span>
                </span>
                {change.kind === 'rescheduled' && change.fromStartsAt && change.toStartsAt ? (
                  <span className="text-muted-foreground">
                    From {dayAndTime(change.fromStartsAt, timeZone)}
                    {change.fromResourceName !== change.toResourceName ? ` with ${change.fromResourceName ?? '—'}` : ''}{' '}
                    to {dayAndTime(change.toStartsAt, timeZone)}
                    {change.fromResourceName !== change.toResourceName ? ` with ${change.toResourceName ?? '—'}` : ''}
                  </span>
                ) : null}
                {change.reason ? <span className="text-muted-foreground">“{change.reason}”</span> : null}
                <time className="text-xs text-muted-foreground" dateTime={change.createdAt}>
                  {dayAndTime(change.createdAt, timeZone)}
                </time>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {dialog === 'move' ? (
        <RescheduleDialog state={state} booking={booking} onClose={() => onDialog(null)} onSaved={refresh} />
      ) : null}
      {dialog === 'details' ? (
        <EditDetailsDialog state={state} booking={booking} onClose={() => onDialog(null)} onSaved={refresh} />
      ) : null}
      {dialog === 'cancel' || dialog === 'decline' ? (
        <EndBookingDialog
          state={state}
          booking={booking}
          kind={dialog}
          onClose={() => onDialog(null)}
          onSaved={refresh}
        />
      ) : null}
    </article>
  );
}
