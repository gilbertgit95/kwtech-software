'use client';

import { cn } from '@kwtech/web-ui/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  BOOKING_CUSTOMER_NAME_MAX,
  BOOKING_REASON_MAX,
  prepareBookingCustomer,
  prepareBookingReason,
} from '../../domain/appointments.js';
import { BOOKING_SLOT_TAKEN_MESSAGE } from '../../domain/slots.js';
import { prepareBookingDay, workspaceBookingDay } from '../../domain/time.js';
import type { BookingRefusal } from '../../types.js';
import type { BookingAppointmentView, BookingDetailsInput, BookingResourceSlotsView } from '../booking-client.js';
import type { BookingAppState } from '../booking-state.js';
import { useBookingAction, useBookingData } from '../use-booking-data.js';
import { clockTime, dayText, durationText } from '../view/time.js';
import { buttonClass, Field, FORM_FOOTER_CLASS, INPUT_CLASS, Modal } from './controls.js';
import { Alert, Empty } from './layout.js';
import { type SlotChoice, SlotGrid } from './slot-grid.js';

/** What the form says for each thing wrong with the customer's details — the server's own check, run first. */
const DETAIL_ERRORS: Partial<Record<BookingRefusal, { field: keyof BookingDetailsInput; message: string }>> = {
  invalid_customer_name: { field: 'customerName', message: 'Enter the customer’s name.' },
  invalid_phone: { field: 'customerPhone', message: 'Enter a phone number in digits.' },
  invalid_email: { field: 'customerEmail', message: 'Enter an e-mail address like name@example.com.' },
  invalid_note: { field: 'note', message: 'That note is too long.' },
};

type DetailErrors = Partial<Record<keyof BookingDetailsInput, string>>;

function detailErrors(draft: BookingDetailsInput): DetailErrors {
  const prepared = prepareBookingCustomer(draft);
  if (!('refused' in prepared)) return {};
  const entry = DETAIL_ERRORS[prepared.refused];
  return entry ? { [entry.field]: entry.message } : {};
}

/**
 * The free times for one service on one day, per resource — a button each.
 *
 * Read from the server every time the service or the day changes, and again
 * whenever somebody else books: a time is offered only while it is free, and
 * the write still checks (`BOOKING_SLOT_TAKEN_MESSAGE`).
 */
function SlotPicker({
  state,
  serviceId,
  day,
  forAppointmentId,
  value,
  onChange,
  reloadKey,
}: {
  state: BookingAppState;
  serviceId: string;
  day: string;
  /** The booking being moved: its own time does not block it. */
  forAppointmentId: string | null;
  value: SlotChoice | null;
  onChange: (choice: SlotChoice | null) => void;
  /** Bumped to read again after a refused write. */
  reloadKey: number;
}) {
  const { client, scope, timeZone } = state;
  const validDay = 'day' in prepareBookingDay(day);
  const load = useCallback(async (): Promise<BookingResourceSlotsView[]> => {
    // Named so that a bump makes a new `load`, which is what makes the hook read again.
    void reloadKey;
    if (!serviceId || !validDay) return [];
    return client.slots(scope, serviceId, day, forAppointmentId);
  }, [client, scope, serviceId, day, validDay, forAppointmentId, reloadKey]);
  const slots = useBookingData(scope, load, ['appointment', 'catalogue', 'settings'], 'Could not load the free times.');
  const resources = state.catalogue.data?.resources ?? [];
  const offered = (slots.data ?? []).filter((entry) => entry.starts.length > 0);

  // A chosen time that is no longer offered is no longer chosen: somebody else took it.
  const stillOffered =
    value === null ||
    slots.data === null ||
    offered.some((entry) => entry.resourceId === value.resourceId && entry.starts.includes(value.startsAt));
  useEffect(() => {
    if (!stillOffered) onChange(null);
  }, [stillOffered, onChange]);

  if (!serviceId) return <Empty>Choose a service to see its free times.</Empty>;
  if (!validDay) return <Empty>Choose a day to see its free times.</Empty>;
  if (slots.error) return <Alert message={slots.error} />;
  if (slots.data === null) return <Empty>Loading the free times…</Empty>;
  if (slots.data.length === 0) {
    return <Empty>Nobody is set up to perform this service yet. Add a resource to it under Services.</Empty>;
  }
  if (offered.length === 0) return <Empty>No free times on {dayText(day)}. Try another day.</Empty>;

  return (
    <SlotGrid
      slots={offered.map((entry) => ({
        resourceId: entry.resourceId,
        name: resources.find((resource) => resource.id === entry.resourceId)?.name ?? 'Resource',
        starts: entry.starts,
      }))}
      timeZone={timeZone}
      value={value}
      onChange={onChange}
    />
  );
}

function DetailFields({
  draft,
  errors,
  onChange,
}: {
  draft: BookingDetailsInput;
  errors: DetailErrors;
  onChange: (patch: Partial<BookingDetailsInput>) => void;
}) {
  return (
    <>
      <Field label="Customer’s name" error={errors.customerName ?? null}>
        {(id, describedBy) => (
          <input
            id={id}
            className={INPUT_CLASS}
            value={draft.customerName}
            maxLength={BOOKING_CUSTOMER_NAME_MAX}
            aria-invalid={errors.customerName ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => onChange({ customerName: event.target.value })}
          />
        )}
      </Field>
      <div className="grid gap-3 @md:grid-cols-2">
        <Field label="Phone" hint="Optional." error={errors.customerPhone ?? null}>
          {(id, describedBy) => (
            <input
              id={id}
              type="tel"
              className={INPUT_CLASS}
              value={draft.customerPhone ?? ''}
              aria-invalid={errors.customerPhone ? true : undefined}
              aria-describedby={describedBy}
              onChange={(event) => onChange({ customerPhone: event.target.value })}
            />
          )}
        </Field>
        <Field label="E-mail" hint="Optional." error={errors.customerEmail ?? null}>
          {(id, describedBy) => (
            <input
              id={id}
              type="email"
              className={INPUT_CLASS}
              value={draft.customerEmail ?? ''}
              aria-invalid={errors.customerEmail ? true : undefined}
              aria-describedby={describedBy}
              onChange={(event) => onChange({ customerEmail: event.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="Note" hint="What the customer needs. Optional." error={errors.note ?? null}>
        {(id, describedBy) => (
          <textarea
            id={id}
            rows={3}
            className={cn(INPUT_CLASS, 'h-auto py-2')}
            value={draft.note}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => onChange({ note: event.target.value })}
          />
        )}
      </Field>
    </>
  );
}

const EMPTY_DETAILS: BookingDetailsInput = { customerName: '', customerPhone: '', customerEmail: '', note: '' };

/**
 * Making a booking at the desk: a service, a day, one of its free times, and
 * who it is for. Confirmed as it is made (D6) — there is nobody else to ask.
 */
export function NewBookingDialog({
  state,
  day: startDay,
  onClose,
  onSaved,
}: {
  state: BookingAppState;
  /** The day the list is showing, where a new booking most likely belongs. */
  day: string;
  onClose: () => void;
  onSaved: (booking: BookingAppointmentView) => void;
}) {
  const services = (state.catalogue.data?.services ?? []).filter((service) => service.resourceIds.length > 0);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [day, setDay] = useState(startDay);
  const [slot, setSlot] = useState<SlotChoice | null>(null);
  const [draft, setDraft] = useState<BookingDetailsInput>(EMPTY_DETAILS);
  const [errors, setErrors] = useState<DetailErrors>({});
  const [slotError, setSlotError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const action = useBookingAction('Could not make the booking.');
  const service = services.find((candidate) => candidate.id === serviceId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = detailErrors(draft);
    setErrors(found);
    setSlotError(slot ? null : 'Choose a time.');
    if (Object.keys(found).length > 0 || !slot) return;
    let saved: BookingAppointmentView | null = null;
    const ok = await action.run(async () => {
      saved = await state.client.create(state.scope, { ...draft, serviceId, ...slot });
    });
    if (ok && saved) onSaved(saved);
  }

  // The one refusal the form acts on: read the free times again, so the taken one is gone from them.
  useEffect(() => {
    if (action.error !== BOOKING_SLOT_TAKEN_MESSAGE) return;
    setSlot(null);
    setReloadKey((key) => key + 1);
  }, [action.error]);

  return (
    <Modal open title="New booking" onClose={onClose} wide>
      {services.length === 0 ? (
        <Empty>
          Nothing can be booked yet. Add a service, and a resource that performs it with its opening hours, first.
        </Empty>
      ) : (
        <form className="@container flex flex-col gap-3" onSubmit={submit} noValidate>
          <Alert message={action.error} onDismiss={action.dismissError} />
          <div className="grid gap-3 @md:grid-cols-2">
            <Field label="Service" hint={service ? durationText(service.durationMinutes) : undefined}>
              {(id, describedBy) => (
                <select
                  id={id}
                  className={INPUT_CLASS}
                  value={serviceId}
                  aria-describedby={describedBy}
                  onChange={(event) => {
                    setServiceId(event.target.value);
                    setSlot(null);
                  }}
                >
                  {services.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Day">
              {(id) => (
                <input
                  id={id}
                  type="date"
                  className={INPUT_CLASS}
                  value={day}
                  onChange={(event) => {
                    setDay(event.target.value);
                    setSlot(null);
                  }}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Time</span>
            <SlotPicker
              state={state}
              serviceId={serviceId}
              day={day}
              forAppointmentId={null}
              value={slot}
              onChange={setSlot}
              reloadKey={reloadKey}
            />
            {slotError && !slot ? (
              <p role="alert" className="text-xs text-destructive">
                {slotError}
              </p>
            ) : null}
          </div>
          <DetailFields draft={draft} errors={errors} onChange={(patch) => setDraft({ ...draft, ...patch })} />
          <footer className={FORM_FOOTER_CLASS}>
            <button type="button" className={buttonClass('ghost')} onClick={onClose} disabled={action.busy}>
              Close
            </button>
            <button type="submit" className={buttonClass('primary')} disabled={action.busy}>
              {action.busy ? 'Booking…' : 'Book'}
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}

/**
 * ⚠ THE APP CANNOT TELL THE CUSTOMER (BOOKING-PLAN §8, D3 with D7). Nothing is
 * sent to them when staff move or cancel a booking, so the dialog says so at
 * that moment, with the phone and e-mail in front of the person about to do it.
 */
function TellTheCustomer({ booking, doing }: { booking: BookingAppointmentView; doing: string }) {
  const contacts = [booking.customerPhone, booking.customerEmail].filter((contact) => contact !== null);
  return (
    <p className="rounded-lg bg-status-warning px-3 py-2.5 text-sm text-status-warning-foreground">
      {booking.customerName} will not be told by the app. After {doing}, tell them yourself
      {contacts.length > 0 ? `: ${contacts.join(' · ')}.` : ' — no phone or e-mail was left on this booking.'}
    </p>
  );
}

/** Moving a booking to another time or resource — the same booking, with where it moved from kept (D7). */
export function RescheduleDialog({
  state,
  booking,
  onClose,
  onSaved,
}: {
  state: BookingAppState;
  booking: BookingAppointmentView;
  onClose: () => void;
  onSaved: () => void;
}) {
  // The day it is on now, in the WORKSPACE's calendar: most moves stay within the day.
  const [day, setDay] = useState(() => workspaceBookingDay(new Date(booking.startsAt), state.timeZone));
  const [slot, setSlot] = useState<SlotChoice | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const action = useBookingAction('Could not move the booking.');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSlotError(slot ? null : 'Choose the new time.');
    if (!slot) return;
    const ok = await action.run(() => state.client.reschedule(state.scope, booking.id, slot.startsAt, slot.resourceId));
    if (ok) onSaved();
  }

  useEffect(() => {
    if (action.error !== BOOKING_SLOT_TAKEN_MESSAGE) return;
    setSlot(null);
    setReloadKey((key) => key + 1);
  }, [action.error]);

  return (
    <Modal open title="Move the booking" onClose={onClose} wide>
      <form className="@container flex flex-col gap-3" onSubmit={submit} noValidate>
        <Alert message={action.error} onDismiss={action.dismissError} />
        <p className="text-sm text-muted-foreground">
          {booking.serviceName} for {booking.customerName}, now at {clockTime(booking.startsAt, state.timeZone)} with{' '}
          {booking.resourceName}.
        </p>
        <Field label="New day">
          {(id) => (
            <input
              id={id}
              type="date"
              className={INPUT_CLASS}
              value={day}
              onChange={(event) => {
                setDay(event.target.value);
                setSlot(null);
              }}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">New time</span>
          <SlotPicker
            state={state}
            serviceId={booking.serviceId}
            day={day}
            forAppointmentId={booking.id}
            value={slot}
            onChange={setSlot}
            reloadKey={reloadKey}
          />
          {slotError && !slot ? (
            <p role="alert" className="text-xs text-destructive">
              {slotError}
            </p>
          ) : null}
        </div>
        <TellTheCustomer booking={booking} doing="moving it" />
        <footer className={FORM_FOOTER_CLASS}>
          <button type="button" className={buttonClass('ghost')} onClick={onClose} disabled={action.busy}>
            Close
          </button>
          <button type="submit" className={buttonClass('primary')} disabled={action.busy}>
            {action.busy ? 'Moving…' : 'Move the booking'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

/**
 * Cancelling, or declining a request: a reason, and the booking is kept with
 * who did it and why (D7). A reason is required to cancel and optional to
 * decline.
 */
export function EndBookingDialog({
  state,
  booking,
  kind,
  onClose,
  onSaved,
}: {
  state: BookingAppState;
  booking: BookingAppointmentView;
  kind: 'cancel' | 'decline';
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const cancelling = kind === 'cancel';
  const action = useBookingAction(cancelling ? 'Could not cancel the booking.' : 'Could not decline the request.');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const prepared = prepareBookingReason(reason, { required: cancelling });
    if ('refused' in prepared) {
      setReasonError(cancelling ? 'Say why it is being cancelled.' : 'That reason is too long.');
      return;
    }
    setReasonError(null);
    const ok = await action.run(() =>
      cancelling
        ? state.client.cancel(state.scope, booking.id, prepared.reason)
        : state.client.decline(state.scope, booking.id, prepared.reason || null),
    );
    if (ok) onSaved();
  }

  return (
    <Modal open title={cancelling ? 'Cancel the booking' : 'Decline the request'} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <Alert message={action.error} onDismiss={action.dismissError} />
        <p className="text-sm text-muted-foreground">
          {booking.serviceName} for {booking.customerName} at {clockTime(booking.startsAt, state.timeZone)}. It stays on
          the list as {cancelling ? 'cancelled' : 'declined'}, and its time becomes free again.
        </p>
        <Field
          label="Reason"
          hint={cancelling ? 'Kept with the booking.' : 'Optional. Kept with the booking.'}
          error={reasonError}
        >
          {(id, describedBy) => (
            <input
              id={id}
              // biome-ignore lint/a11y/noAutofocus: the dialog exists to take this one line; focus starts on it, not on Close.
              autoFocus
              className={INPUT_CLASS}
              value={reason}
              maxLength={BOOKING_REASON_MAX}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={describedBy}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
        <TellTheCustomer booking={booking} doing={cancelling ? 'cancelling' : 'declining'} />
        <footer className={FORM_FOOTER_CLASS}>
          <button type="button" className={buttonClass('ghost')} onClick={onClose} disabled={action.busy}>
            Keep it
          </button>
          <button type="submit" className={buttonClass('danger')} disabled={action.busy}>
            {action.busy ? 'Saving…' : cancelling ? 'Cancel the booking' : 'Decline the request'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

/** Correcting the customer's details or the note. */
export function EditDetailsDialog({
  state,
  booking,
  onClose,
  onSaved,
}: {
  state: BookingAppState;
  booking: BookingAppointmentView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<BookingDetailsInput>({
    customerName: booking.customerName,
    customerPhone: booking.customerPhone ?? '',
    customerEmail: booking.customerEmail ?? '',
    note: booking.note,
  });
  const [errors, setErrors] = useState<DetailErrors>({});
  const action = useBookingAction('Could not save the details.');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = detailErrors(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const ok = await action.run(() => state.client.updateDetails(state.scope, booking.id, draft));
    if (ok) onSaved();
  }

  return (
    <Modal open title="Correct the details" onClose={onClose} wide>
      <form className="@container flex flex-col gap-3" onSubmit={submit} noValidate>
        <Alert message={action.error} onDismiss={action.dismissError} />
        <DetailFields draft={draft} errors={errors} onChange={(patch) => setDraft({ ...draft, ...patch })} />
        <footer className={FORM_FOOTER_CLASS}>
          <button type="button" className={buttonClass('ghost')} onClick={onClose} disabled={action.busy}>
            Close
          </button>
          <button type="submit" className={buttonClass('primary')} disabled={action.busy}>
            {action.busy ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
