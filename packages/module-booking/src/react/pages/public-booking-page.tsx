'use client';

import { cn } from '@kwtech/web-ui/react';
import { Check, Clock, Copy } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { BOOKING_CUSTOMER_NAME_MAX, prepareBookingCustomer } from '../../domain/appointments.js';
import { BOOKING_SLOT_TAKEN_MESSAGE } from '../../domain/slots.js';
import { prepareBookingDay } from '../../domain/time.js';
import {
  createPublicBookingClient,
  type PublicBookingClient,
  type PublicBookingView,
  type PublicPageView,
  type PublicSlotsView,
} from '../booking-public-client.js';
import { buttonClass, Field, INPUT_CLASS } from '../components/controls.js';
import { Alert, Empty } from '../components/layout.js';
import { PublicCard, PublicFrame } from '../components/public-frame.js';
import { type SlotChoice, SlotGrid } from '../components/slot-grid.js';
import { bookingManageHref } from '../routes.js';
import { formatPrice } from '../view/money.js';
import { bookableDays, cutoffText, publicTimeZone } from '../view/public.js';
import { dayAndTime, dayLabel, dayText, durationText } from '../view/time.js';

export interface PublicBookingPageProps {
  params: Record<string, string>;
  /** Injectable, so the page can be driven without a server. */
  client?: PublicBookingClient;
}

interface Details {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  note: string;
}

type DetailErrors = Partial<Record<keyof Details, string>>;

/** The same check the server runs, said beside the field. A way to be reached is the page's own rule. */
function detailErrors(details: Details): DetailErrors {
  const prepared = prepareBookingCustomer(details);
  if ('refused' in prepared) {
    switch (prepared.refused) {
      case 'invalid_customer_name':
        return { customerName: 'Enter your name.' };
      case 'invalid_phone':
        return { customerPhone: 'Enter a phone number in digits.' };
      case 'invalid_email':
        return { customerEmail: 'Enter an e-mail address like name@example.com.' };
      case 'invalid_note':
        return { note: 'That note is too long.' };
      default:
        return {};
    }
  }
  if (!prepared.customer.customerPhone && !prepared.customer.customerEmail) {
    return { customerPhone: 'Leave a phone number or an e-mail address, so we can reach you.' };
  }
  return {};
}

/**
 * The page a customer books on (BOOKING-PLAN §6). Nobody is signed in.
 *
 * Four steps on one page — what, which day, what time, who — each shown once
 * the one before it is answered, so a phone never shows a wall of fields.
 *
 * ⚠ WHAT IS SENT IS A REQUEST (D2). The button says "Request this booking",
 * and the page that follows says "We will confirm" — never "You are booked".
 *
 * ⚠ Every time is printed in the SHOP's zone, which arrives with the page and
 * is checked before use: a visitor has no workspace, and may be anywhere.
 */
export function PublicBookingPage({ params, client }: PublicBookingPageProps) {
  const linkId = params.linkId ?? '';
  const api = useMemo(() => client ?? createPublicBookingClient(), [client]);
  const [page, setPage] = useState<PublicPageView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'closed' | 'unreachable'>('loading');
  const [sent, setSent] = useState<{ manageToken: string; booking: PublicBookingView } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .page(linkId)
      .then((answer) => {
        if (cancelled) return;
        setPage(answer);
        setState(answer ? 'ready' : 'closed');
      })
      .catch(() => {
        if (!cancelled) setState('unreachable');
      });
    return () => {
      cancelled = true;
    };
  }, [api, linkId]);

  if (state === 'loading') {
    return (
      <PublicFrame title={null}>
        <Empty>Loading…</Empty>
      </PublicFrame>
    );
  }
  if (state === 'unreachable') {
    return (
      <PublicFrame title={null}>
        <PublicCard title="We could not load this page">
          <p className="text-sm text-muted-foreground">Check your connection and open the link again.</p>
        </PublicCard>
      </PublicFrame>
    );
  }
  // ⚠ ONE answer for a link that never existed and a page that was turned off.
  if (state === 'closed' || !page) {
    return (
      <PublicFrame title={null}>
        <PublicCard title="Bookings are not being taken here">
          <p className="text-sm text-muted-foreground">
            This link is not open for bookings. If you were given it by a business, please contact them directly.
          </p>
        </PublicCard>
      </PublicFrame>
    );
  }

  return (
    <PublicFrame title={page.title} note={page.note}>
      {sent ? <RequestSent sent={sent} /> : <RequestForm api={api} linkId={linkId} page={page} onSent={setSent} />}
    </PublicFrame>
  );
}

function RequestForm({
  api,
  linkId,
  page,
  onSent,
}: {
  api: PublicBookingClient;
  linkId: string;
  page: PublicPageView;
  onSent: (sent: { manageToken: string; booking: PublicBookingView }) => void;
}) {
  const timeZone = publicTimeZone(page.timeZone);
  const [serviceId, setServiceId] = useState(page.services.length === 1 ? (page.services[0]?.id ?? '') : '');
  const [day, setDay] = useState('');
  const [slot, setSlot] = useState<SlotChoice | null>(null);
  const [slots, setSlots] = useState<PublicSlotsView[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [details, setDetails] = useState<Details>({ customerName: '', customerPhone: '', customerEmail: '', note: '' });
  const [errors, setErrors] = useState<DetailErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const service = page.services.find((candidate) => candidate.id === serviceId);
  const validDay = 'day' in prepareBookingDay(day);

  // The free times for the chosen service and day — read again when either changes, and after a refused request.
  useEffect(() => {
    if (!serviceId || !validDay) {
      setSlots(null);
      return;
    }
    // Named so that a bump reads the times again.
    void reload;
    let cancelled = false;
    setSlots(null);
    setSlotsError(null);
    api
      .slots(linkId, serviceId, day)
      .then((answer) => {
        if (!cancelled) setSlots(answer ?? []);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setSlotsError(caught instanceof Error ? caught.message : 'Could not load the free times.');
      });
    return () => {
      cancelled = true;
    };
  }, [api, linkId, serviceId, day, validDay, reload]);

  const choose = useCallback((choice: SlotChoice) => setSlot(choice), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = detailErrors(details);
    setErrors(found);
    if (Object.keys(found).length > 0 || !slot || sending) return;
    setSending(true);
    setError(null);
    try {
      onSent(
        await api.request(linkId, {
          serviceId,
          ...slot,
          customerName: details.customerName,
          customerPhone: details.customerPhone || null,
          customerEmail: details.customerEmail || null,
          note: details.note,
        }),
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Your request could not be sent.';
      setError(message);
      // Somebody took the time while the form was being filled in: show what is still free.
      if (message === BOOKING_SLOT_TAKEN_MESSAGE) {
        setSlot(null);
        setReload((count) => count + 1);
      }
    } finally {
      setSending(false);
    }
  }

  if (page.services.length === 0) {
    return (
      <PublicCard title="Nothing can be booked yet">
        <p className="text-sm text-muted-foreground">Please check back later, or contact us directly.</p>
      </PublicCard>
    );
  }

  const offered = (slots ?? []).filter((entry) => entry.starts.length > 0);

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <PublicCard title="1. What would you like to book?">
        <div className="grid gap-2 @md:grid-cols-2">
          {page.services.map((candidate) => {
            const chosen = candidate.id === serviceId;
            return (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={chosen}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  chosen ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border hover:bg-accent',
                )}
                onClick={() => {
                  setServiceId(candidate.id);
                  setSlot(null);
                }}
              >
                <span className="text-sm font-semibold">{candidate.name}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock aria-hidden="true" className="size-3" />
                  {durationText(candidate.durationMinutes)}
                  {candidate.price !== null ? ` · ${formatPrice(candidate.price)}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </PublicCard>

      {service ? (
        <PublicCard title="2. Which day?">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {bookableDays(page.today, page.lastDay).map((each) => (
              <button
                key={each}
                type="button"
                aria-pressed={each === day}
                className={cn(
                  'flex shrink-0 flex-col items-center rounded-xl border px-3 py-2 text-xs transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  each === day
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card hover:bg-accent',
                )}
                onClick={() => {
                  setDay(each);
                  setSlot(null);
                }}
              >
                {dayLabel(each, page.today)}
              </button>
            ))}
          </div>
          <Field label="Or pick a date" hint={`Bookings are taken up to ${dayText(page.lastDay)}.`}>
            {(id, describedBy) => (
              <input
                id={id}
                type="date"
                className={INPUT_CLASS}
                value={day}
                min={page.today}
                max={page.lastDay}
                aria-describedby={describedBy}
                onChange={(event) => {
                  setDay(event.target.value);
                  setSlot(null);
                }}
              />
            )}
          </Field>
        </PublicCard>
      ) : null}

      {service && validDay ? (
        <PublicCard title="3. What time?">
          <Alert message={slotsError} />
          {slots === null && !slotsError ? <Empty>Loading the free times…</Empty> : null}
          {slots !== null && offered.length === 0 ? (
            <Empty>Nothing is free on {dayText(day)}. Try another day.</Empty>
          ) : null}
          {offered.length > 0 ? (
            <SlotGrid
              slots={offered.map((entry) => ({
                resourceId: entry.resourceId,
                name: entry.resourceName,
                starts: entry.starts,
              }))}
              timeZone={timeZone}
              value={slot}
              onChange={choose}
            />
          ) : null}
          <p className="text-xs text-muted-foreground">Times are shown in {timeZone.replace(/_/gu, ' ')} time.</p>
        </PublicCard>
      ) : null}

      {service && slot ? (
        <PublicCard title="4. Your details">
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="font-medium">{service.name}</span> — {dayAndTime(slot.startsAt, timeZone)}
          </p>
          <Field label="Your name" error={errors.customerName ?? null}>
            {(id, describedBy) => (
              <input
                id={id}
                className={INPUT_CLASS}
                autoComplete="name"
                value={details.customerName}
                maxLength={BOOKING_CUSTOMER_NAME_MAX}
                aria-invalid={errors.customerName ? true : undefined}
                aria-describedby={describedBy}
                onChange={(event) => setDetails({ ...details, customerName: event.target.value })}
              />
            )}
          </Field>
          <div className="grid gap-3 @md:grid-cols-2">
            <Field label="Phone" hint="Phone or e-mail — at least one." error={errors.customerPhone ?? null}>
              {(id, describedBy) => (
                <input
                  id={id}
                  type="tel"
                  autoComplete="tel"
                  className={INPUT_CLASS}
                  value={details.customerPhone}
                  aria-invalid={errors.customerPhone ? true : undefined}
                  aria-describedby={describedBy}
                  onChange={(event) => setDetails({ ...details, customerPhone: event.target.value })}
                />
              )}
            </Field>
            <Field label="E-mail" error={errors.customerEmail ?? null}>
              {(id, describedBy) => (
                <input
                  id={id}
                  type="email"
                  autoComplete="email"
                  className={INPUT_CLASS}
                  value={details.customerEmail}
                  aria-invalid={errors.customerEmail ? true : undefined}
                  aria-describedby={describedBy}
                  onChange={(event) => setDetails({ ...details, customerEmail: event.target.value })}
                />
              )}
            </Field>
          </div>
          <Field label="Anything we should know?" hint="Optional." error={errors.note ?? null}>
            {(id, describedBy) => (
              <textarea
                id={id}
                rows={3}
                className={cn(INPUT_CLASS, 'h-auto py-2')}
                value={details.note}
                aria-invalid={errors.note ? true : undefined}
                aria-describedby={describedBy}
                onChange={(event) => setDetails({ ...details, note: event.target.value })}
              />
            )}
          </Field>
          <Alert message={error} onDismiss={() => setError(null)} />
          <button type="submit" className={cn(buttonClass('primary'), 'h-11 w-full')} disabled={sending}>
            {sending ? 'Sending…' : 'Request this booking'}
          </button>
          {/* ⚠ Said BEFORE the press as well as after: this asks, it does not book (D2). */}
          <p className="text-center text-xs text-muted-foreground">
            This sends a request. We will confirm your booking — you are not booked until we do. You can cancel or
            change it yourself {cutoffText(page.cutoffMinutes)}.
          </p>
        </PublicCard>
      ) : null}
    </form>
  );
}

/**
 * The request was sent. ⚠ THE MANAGE LINK IS SHOWN NOW AND NEVER AGAIN: it is
 * the customer's only way back to this booking, and nothing is e-mailed to
 * them (D3). So the page says so, and makes the link easy to keep.
 */
function RequestSent({ sent }: { sent: { manageToken: string; booking: PublicBookingView } }) {
  const { booking } = sent;
  const timeZone = publicTimeZone(booking.timeZone);
  const path = bookingManageHref(sent.manageToken);
  // The whole address, for copying. Only the browser knows the site it is on.
  const [link, setLink] = useState(path);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setLink(new URL(path, window.location.origin).toString());
  }, [path]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // No clipboard (an old browser, or not allowed): the link is on screen to be copied by hand.
      setCopied(false);
    }
  }

  return (
    <>
      <PublicCard>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-status-success text-status-success-foreground">
            <Check aria-hidden="true" className="size-5" />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold tracking-tight">Request sent — we will confirm your booking</h2>
            <p className="text-sm text-muted-foreground">
              {booking.serviceName} with {booking.resourceName}, {dayAndTime(booking.startsAt, timeZone)}. The time is
              being held for you, but you are not booked until we confirm.
            </p>
          </div>
        </div>
      </PublicCard>
      <PublicCard title="Keep this link">
        <p className="text-sm text-muted-foreground">
          It is the only way to see whether your booking was confirmed, and to cancel or change it. We do not send it by
          message, and we cannot show it again — save it now.
        </p>
        <p className="break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs">{link}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass('secondary')} onClick={copy}>
            <Copy aria-hidden="true" className="size-4" />
            {copied ? 'Copied' : 'Copy the link'}
          </button>
          <a className={buttonClass('primary')} href={path}>
            Open my booking
          </a>
        </div>
        {copied ? (
          <p role="status" className="text-xs text-muted-foreground">
            Copied. Paste it somewhere you will find it again.
          </p>
        ) : null}
      </PublicCard>
    </>
  );
}
