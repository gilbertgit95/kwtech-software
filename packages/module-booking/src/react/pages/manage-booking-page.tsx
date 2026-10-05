'use client';

import { cn } from '@kwtech/web-ui/react';
import { CalendarClock, Clock, MapPin, RefreshCw, X } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { BOOKING_REASON_MAX } from '../../domain/appointments.js';
import { BOOKING_SLOT_TAKEN_MESSAGE } from '../../domain/slots.js';
import { prepareBookingDay, workspaceBookingDay } from '../../domain/time.js';
import {
  createPublicBookingClient,
  type PublicBookingClient,
  type PublicBookingView,
  type PublicSlotsView,
} from '../booking-public-client.js';
import { buttonClass, Field, INPUT_CLASS } from '../components/controls.js';
import { Alert, Empty, StatusChip } from '../components/layout.js';
import { PublicCard, PublicFrame } from '../components/public-frame.js';
import { type SlotChoice, SlotGrid } from '../components/slot-grid.js';
import { customerStatus, cutoffText, publicTimeZone } from '../view/public.js';
import { clockTime, dayAndTime, dayText } from '../view/time.js';

export interface ManageBookingPageProps {
  params: Record<string, string>;
  /** Injectable, so the page can be driven without a server. */
  client?: PublicBookingClient;
}

type Mode = 'view' | 'cancel' | 'move';

/**
 * A customer's own booking, reached by the manage link they were given
 * (BOOKING-PLAN §6). The token in the address is their only credential.
 *
 * It is where they find out whether their request was confirmed — the app
 * sends them nothing (D3) — and where they cancel or move it, up to the shop's
 * cutoff.
 *
 * ⚠ ONE answer for a link nobody was given, whatever is wrong with it.
 */
export function ManageBookingPage({ params, client }: ManageBookingPageProps) {
  const token = params.token ?? '';
  const api = useMemo(() => client ?? createPublicBookingClient(), [client]);
  const [booking, setBooking] = useState<PublicBookingView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unknown' | 'unreachable'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('view');

  const load = useCallback(async () => {
    try {
      const answer = await api.booking(token);
      setBooking(answer);
      setState(answer ? 'ready' : 'unknown');
      setMessage(null);
    } catch (caught) {
      // The tight limit on this page says so in its own words; anything else is the connection.
      setMessage(caught instanceof Error ? caught.message : null);
      setState('unreachable');
    }
  }, [api, token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <PublicFrame title={null}>
        <Empty>Loading your booking…</Empty>
      </PublicFrame>
    );
  }
  if (state === 'unreachable') {
    return (
      <PublicFrame title={null}>
        <PublicCard title="We could not load your booking">
          <p className="text-sm text-muted-foreground">{message ?? 'Check your connection and try again.'}</p>
          <div>
            <button type="button" className={buttonClass('secondary')} onClick={() => void load()}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Try again
            </button>
          </div>
        </PublicCard>
      </PublicFrame>
    );
  }
  if (state === 'unknown' || !booking) {
    return (
      <PublicFrame title={null}>
        <PublicCard title="We could not find that booking">
          <p className="text-sm text-muted-foreground">
            Check that the whole link was copied. If it still does not open, please contact the business you booked
            with.
          </p>
        </PublicCard>
      </PublicFrame>
    );
  }

  const timeZone = publicTimeZone(booking.timeZone);
  const status = customerStatus(booking.status, booking.reason);
  const done = (next: PublicBookingView) => {
    setBooking(next);
    setMode('view');
  };

  return (
    <PublicFrame title={booking.title} note={booking.note}>
      <PublicCard>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">{booking.customerName}</h2>
          <StatusChip label={status.label} tone={status.tone} />
        </div>
        <p className="text-sm text-muted-foreground">{status.explain}</p>
        <div className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3 text-sm">
          <span className="flex items-start gap-2.5">
            <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">
              {dayAndTime(booking.startsAt, timeZone)} – {clockTime(booking.endsAt, timeZone)}
            </span>
          </span>
          <span className="flex items-start gap-2.5">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              {booking.serviceName} <span className="text-muted-foreground">with</span> {booking.resourceName}
            </span>
          </span>
        </div>
        <p className="text-xs text-muted-foreground">Times are shown in {timeZone.replace(/_/gu, ' ')} time.</p>

        {mode === 'view' ? (
          <div className="flex flex-wrap gap-2">
            {booking.canChange ? (
              <>
                <button type="button" className={buttonClass('secondary')} onClick={() => setMode('move')}>
                  <CalendarClock aria-hidden="true" className="size-4" />
                  Change the time
                </button>
                <button
                  type="button"
                  className={cn(
                    buttonClass('ghost'),
                    'text-destructive hover:bg-destructive/10 hover:text-destructive',
                  )}
                  onClick={() => setMode('cancel')}
                >
                  <X aria-hidden="true" className="size-4" />
                  Cancel booking
                </button>
              </>
            ) : null}
            <button type="button" className={cn(buttonClass('ghost'), 'ml-auto')} onClick={() => void load()}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Check again
            </button>
          </div>
        ) : null}
        {/* Past the cutoff, with a booking still ahead: say where to turn, rather than showing nothing. */}
        {mode === 'view' && !booking.canChange && (booking.status === 'pending' || booking.status === 'confirmed') ? (
          <p className="rounded-lg bg-status-info px-3 py-2 text-sm text-status-info-foreground">
            It is too close to the time to change or cancel this here. Please contact us directly.
          </p>
        ) : null}
        {mode === 'view' && booking.canChange ? (
          <p className="text-xs text-muted-foreground">
            You can change or cancel this yourself {cutoffText(booking.cutoffMinutes)}.
          </p>
        ) : null}
      </PublicCard>

      {mode === 'cancel' ? <CancelCard api={api} token={token} onDone={done} onBack={() => setMode('view')} /> : null}
      {mode === 'move' ? (
        <MoveCard api={api} token={token} booking={booking} onDone={done} onBack={() => setMode('view')} />
      ) : null}
    </PublicFrame>
  );
}

function CancelCard({
  api,
  token,
  onDone,
  onBack,
}: {
  api: PublicBookingClient;
  token: string;
  onDone: (booking: PublicBookingView) => void;
  onBack: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api.cancel(token, reason.trim() || null));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your booking could not be cancelled.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicCard title="Cancel this booking?">
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <p className="text-sm text-muted-foreground">Your time will be given up, and somebody else can take it.</p>
        <Field label="Reason" hint="Optional.">
          {(id, describedBy) => (
            <input
              id={id}
              className={INPUT_CLASS}
              value={reason}
              maxLength={BOOKING_REASON_MAX}
              aria-describedby={describedBy}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
        <Alert message={error} onDismiss={() => setError(null)} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonClass('ghost')} onClick={onBack} disabled={busy}>
            Keep my booking
          </button>
          <button type="submit" className={buttonClass('danger')} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel booking'}
          </button>
        </div>
      </form>
    </PublicCard>
  );
}

/**
 * Moving a booking. ⚠ IT GOES BACK TO WAITING (D8), and the old time is given
 * up whether or not the new one is accepted — so the card says so BEFORE the
 * press, not after.
 */
function MoveCard({
  api,
  token,
  booking,
  onDone,
  onBack,
}: {
  api: PublicBookingClient;
  token: string;
  booking: PublicBookingView;
  onDone: (booking: PublicBookingView) => void;
  onBack: () => void;
}) {
  const timeZone = publicTimeZone(booking.timeZone);
  // Start on the day it is on now, if that day can still be booked.
  const current = workspaceBookingDay(new Date(booking.startsAt), timeZone);
  const [day, setDay] = useState(current >= booking.today && current <= booking.lastDay ? current : booking.today);
  const [slot, setSlot] = useState<SlotChoice | null>(null);
  const [slots, setSlots] = useState<PublicSlotsView[] | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const validDay = 'day' in prepareBookingDay(day);

  useEffect(() => {
    if (!validDay) {
      setSlots(null);
      return;
    }
    // Named so that a bump reads the times again.
    void reload;
    let cancelled = false;
    setSlots(null);
    api
      .moveSlots(token, day)
      .then((answer) => {
        if (!cancelled) setSlots(answer ?? []);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load the free times.');
      });
    return () => {
      cancelled = true;
    };
  }, [api, token, day, validDay, reload]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!slot || busy) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api.reschedule(token, slot.startsAt, slot.resourceId));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Your booking could not be moved.';
      setError(message);
      if (message === BOOKING_SLOT_TAKEN_MESSAGE) {
        setSlot(null);
        setReload((count) => count + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  // The time it already has is not a move.
  const offered = (slots ?? [])
    .map((entry) => ({
      resourceId: entry.resourceId,
      name: entry.resourceName,
      starts: entry.starts.filter((start) => !(entry.resourceId === booking.resourceId && start === booking.startsAt)),
    }))
    .filter((entry) => entry.starts.length > 0);

  return (
    <PublicCard title="Change the time">
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <p className="rounded-lg bg-status-warning px-3 py-2 text-sm text-status-warning-foreground">
          A new time has to be confirmed again. Your current time is given up as soon as you ask — if we cannot take the
          new one, you will not have either.
        </p>
        <Field label="New day" hint={`Up to ${dayText(booking.lastDay)}.`}>
          {(id, describedBy) => (
            <input
              id={id}
              type="date"
              className={INPUT_CLASS}
              value={day}
              min={booking.today}
              max={booking.lastDay}
              aria-describedby={describedBy}
              onChange={(event) => {
                setDay(event.target.value);
                setSlot(null);
              }}
            />
          )}
        </Field>
        {validDay && slots === null && !error ? <Empty>Loading the free times…</Empty> : null}
        {slots !== null && offered.length === 0 ? <Empty>Nothing else is free on {dayText(day)}.</Empty> : null}
        {offered.length > 0 ? <SlotGrid slots={offered} timeZone={timeZone} value={slot} onChange={setSlot} /> : null}
        <Alert message={error} onDismiss={() => setError(null)} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonClass('ghost')} onClick={onBack} disabled={busy}>
            Keep my time
          </button>
          <button type="submit" className={buttonClass('primary')} disabled={busy || !slot}>
            {busy ? 'Asking…' : 'Ask for this time'}
          </button>
        </div>
      </form>
    </PublicCard>
  );
}
