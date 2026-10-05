'use client';

import { cn } from '@kwtech/web-ui/react';
import { Archive, ArchiveRestore, Banknote, ClipboardList, Clock, Hourglass, Pencil, Plus } from 'lucide-react';
import { type FormEvent, useCallback, useState } from 'react';
import {
  BOOKING_BUFFER_MAX_MINUTES,
  BOOKING_DURATION_MAX_MINUTES,
  BOOKING_DURATION_MIN_MINUTES,
  BOOKING_NAME_MAX,
  prepareBookingService,
} from '../../domain/catalogue.js';
import type { BookingRefusal } from '../../types.js';
import type { BookingResourceView, BookingServiceView } from '../booking-client.js';
import type { BookingAppState } from '../booking-state.js';
import { useBookingAction, useBookingData } from '../use-booking-data.js';
import { formatPrice, parsePrice, priceInputValue } from '../view/money.js';
import { durationText } from '../view/time.js';
import { buttonClass, Field, FORM_FOOTER_CLASS, INPUT_CLASS, Modal } from './controls.js';
import { Alert, Empty, EmptyState, StatusChip, Tag } from './layout.js';

interface ServiceDraft {
  name: string;
  duration: string;
  bufferBefore: string;
  bufferAfter: string;
  price: string;
  resourceIds: string[];
}

type ServiceErrors = Partial<Record<'name' | 'duration' | 'buffer' | 'price', string>>;

const FIELD_OF: Partial<Record<BookingRefusal, keyof ServiceErrors>> = {
  invalid_name: 'name',
  invalid_duration: 'duration',
  invalid_buffer: 'buffer',
  invalid_price: 'price',
};

const MESSAGES: Record<keyof ServiceErrors, string> = {
  name: 'Give the service a name.',
  duration: `Enter whole minutes, from ${BOOKING_DURATION_MIN_MINUTES} to ${BOOKING_DURATION_MAX_MINUTES}.`,
  buffer: `Enter whole minutes, from 0 to ${BOOKING_BUFFER_MAX_MINUTES}.`,
  price: 'Enter an amount like 1500 or 1500.50, or leave it empty.',
};

/** A whole number typed into a box, or NaN — which the domain's check then refuses. */
const minutesOf = (text: string): number => (/^\d+$/u.test(text.trim()) ? Number(text.trim()) : Number.NaN);

function draftOf(service: BookingServiceView | null): ServiceDraft {
  return {
    name: service?.name ?? '',
    duration: String(service?.durationMinutes ?? 30),
    bufferBefore: String(service?.bufferBeforeMinutes ?? 0),
    bufferAfter: String(service?.bufferAfterMinutes ?? 0),
    price: priceInputValue(service?.price ?? null),
    resourceIds: service?.resourceIds ?? [],
  };
}

/**
 * Services (BOOKING-PLAN §2): what can be booked, how long it takes, and who or
 * what performs it. Archived, never deleted — old bookings name them.
 */
export function ServicesSection({ state }: { state: BookingAppState }) {
  const { client, scope } = state;
  const [showArchived, setShowArchived] = useState(false);
  /** A service being edited, or `'new'`. */
  const [editing, setEditing] = useState<BookingServiceView | 'new' | null>(null);
  const load = useCallback(() => client.catalogue(scope, showArchived), [client, scope, showArchived]);
  const list = useBookingData(scope, load, ['catalogue'], 'Could not load the services.');
  const action = useBookingAction('Could not change the service.');
  const services = list.data?.services ?? [];
  const resources = (list.data?.resources ?? []).filter((resource) => resource.archivedAt === null);

  const setArchived = async (service: BookingServiceView, archived: boolean) => {
    if (await action.run(() => client.setServiceArchived(scope, service.id, archived))) await list.reload();
  };

  const addService = (
    <button type="button" className={buttonClass('primary')} onClick={() => setEditing('new')}>
      <Plus aria-hidden="true" className="size-4" />
      Add a service
    </button>
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Services">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-lg font-semibold tracking-tight">Services</h2>
          <p className="text-sm text-muted-foreground">
            What a customer books: a name, how long it takes, and who performs it.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Show archived
          </label>
          {addService}
        </div>
      </header>
      <Alert message={list.error ?? action.error} onDismiss={action.error ? action.dismissError : undefined} />
      {list.data === null && !list.error ? <Empty>Loading the services…</Empty> : null}
      {list.data !== null && services.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No services yet" action={addService}>
          Add the first thing customers can book. Then add who or what performs it under Resources.
        </EmptyState>
      ) : null}
      <ul className="m-0 grid min-h-0 list-none auto-rows-min gap-3 overflow-y-auto p-0 pb-1 @2xl:grid-cols-2 @5xl:grid-cols-3">
        {services.map((service) => {
          const performers = resources.filter((resource) => service.resourceIds.includes(resource.id));
          return (
            <li
              key={service.id}
              className={cn(
                'flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs',
                service.archivedAt ? 'opacity-70' : null,
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 truncate text-base font-semibold">{service.name}</h3>
                {service.archivedAt ? <StatusChip label="Archived" tone="neutral" /> : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Tag icon={Clock}>{durationText(service.durationMinutes)}</Tag>
                {service.price !== null ? <Tag icon={Banknote}>{formatPrice(service.price)}</Tag> : null}
                {service.bufferBeforeMinutes + service.bufferAfterMinutes > 0 ? (
                  <Tag icon={Hourglass}>
                    {durationText(service.bufferBeforeMinutes + service.bufferAfterMinutes)} kept clear
                  </Tag>
                ) : null}
              </div>
              {performers.length === 0 ? (
                <p className="rounded-lg bg-status-warning px-2.5 py-1.5 text-xs text-status-warning-foreground">
                  Nobody performs it yet, so it cannot be booked.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">With</span>
                  {performers.slice(0, PERFORMERS_SHOWN).map((resource) => (
                    <Tag key={resource.id}>{resource.name}</Tag>
                  ))}
                  {performers.length > PERFORMERS_SHOWN ? (
                    <span className="text-xs text-muted-foreground">
                      and {performers.length - PERFORMERS_SHOWN} more
                    </span>
                  ) : null}
                </div>
              )}
              <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
                <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setEditing(service)}>
                  <Pencil aria-hidden="true" className="size-3.5" />
                  Edit<span className="sr-only"> {service.name}</span>
                </button>
                <button
                  type="button"
                  className={cn(buttonClass('ghost', 'sm'), 'ml-auto')}
                  disabled={action.busy}
                  onClick={() => setArchived(service, service.archivedAt === null)}
                >
                  {service.archivedAt ? (
                    <ArchiveRestore aria-hidden="true" className="size-3.5" />
                  ) : (
                    <Archive aria-hidden="true" className="size-3.5" />
                  )}
                  {service.archivedAt ? 'Restore' : 'Archive'}
                  <span className="sr-only"> {service.name}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {editing ? (
        <ServiceForm
          state={state}
          service={editing === 'new' ? null : editing}
          resources={resources}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await list.reload();
          }}
        />
      ) : null}
    </section>
  );
}

/** How many performers a card names before it counts the rest. */
const PERFORMERS_SHOWN = 4;

function ServiceForm({
  state,
  service,
  resources,
  onClose,
  onSaved,
}: {
  state: BookingAppState;
  service: BookingServiceView | null;
  resources: readonly BookingResourceView[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ServiceDraft>(() => draftOf(service));
  const [errors, setErrors] = useState<ServiceErrors>({});
  const action = useBookingAction('Could not save the service.');
  const set = (patch: Partial<ServiceDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const price = draft.price.trim() === '' ? null : parsePrice(draft.price);
    if (draft.price.trim() !== '' && price === null) {
      setErrors({ price: MESSAGES.price });
      return;
    }
    const input = {
      name: draft.name,
      durationMinutes: minutesOf(draft.duration),
      bufferBeforeMinutes: minutesOf(draft.bufferBefore),
      bufferAfterMinutes: minutesOf(draft.bufferAfter),
      price,
      resourceIds: draft.resourceIds,
    };
    // The same check the server runs, so a mistake is said beside its field and not after a round trip.
    const prepared = prepareBookingService(input);
    if ('refused' in prepared) {
      const field = FIELD_OF[prepared.refused];
      setErrors(field ? { [field]: MESSAGES[field] } : {});
      if (field) return;
    } else {
      setErrors({});
    }
    if (await action.run(() => state.client.saveService(state.scope, service?.id ?? null, input))) await onSaved();
  }

  const toggle = (resourceId: string) =>
    set({
      resourceIds: draft.resourceIds.includes(resourceId)
        ? draft.resourceIds.filter((id) => id !== resourceId)
        : [...draft.resourceIds, resourceId],
    });

  return (
    <Modal open title={service ? 'Change the service' : 'Add a service'} onClose={onClose} wide>
      <form className="@container flex flex-col gap-3" onSubmit={submit} noValidate>
        <Alert message={action.error} onDismiss={action.dismissError} />
        <Field label="Name" error={errors.name ?? null}>
          {(id, describedBy) => (
            <input
              id={id}
              // biome-ignore lint/a11y/noAutofocus: the form opens on its first field, not on Close.
              autoFocus
              className={INPUT_CLASS}
              value={draft.name}
              maxLength={BOOKING_NAME_MAX}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describedBy}
              onChange={(event) => set({ name: event.target.value })}
            />
          )}
        </Field>
        <div className="grid gap-3 @md:grid-cols-2">
          <Field label="Length, in minutes" error={errors.duration ?? null}>
            {(id, describedBy) => (
              <input
                id={id}
                inputMode="numeric"
                className={INPUT_CLASS}
                value={draft.duration}
                aria-invalid={errors.duration ? true : undefined}
                aria-describedby={describedBy}
                onChange={(event) => set({ duration: event.target.value })}
              />
            )}
          </Field>
          <Field label="Price" hint="Shown, never charged. Optional." error={errors.price ?? null}>
            {(id, describedBy) => (
              <input
                id={id}
                inputMode="decimal"
                className={INPUT_CLASS}
                value={draft.price}
                aria-invalid={errors.price ? true : undefined}
                aria-describedby={describedBy}
                onChange={(event) => set({ price: event.target.value })}
              />
            )}
          </Field>
          <Field
            label="Kept clear before, in minutes"
            hint="Time to get ready. Nothing else is booked in it."
            error={errors.buffer ?? null}
          >
            {(id, describedBy) => (
              <input
                id={id}
                inputMode="numeric"
                className={INPUT_CLASS}
                value={draft.bufferBefore}
                aria-invalid={errors.buffer ? true : undefined}
                aria-describedby={describedBy}
                onChange={(event) => set({ bufferBefore: event.target.value })}
              />
            )}
          </Field>
          <Field label="Kept clear after, in minutes" hint="Time to clear up.">
            {(id, describedBy) => (
              <input
                id={id}
                inputMode="numeric"
                className={INPUT_CLASS}
                value={draft.bufferAfter}
                aria-invalid={errors.buffer ? true : undefined}
                aria-describedby={describedBy}
                onChange={(event) => set({ bufferAfter: event.target.value })}
              />
            )}
          </Field>
        </div>
        <fieldset className="m-0 flex flex-col gap-2 rounded-xl border border-border p-3.5">
          <legend className="px-1 text-sm font-medium">Performed by</legend>
          {resources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No resources yet. Add one under Resources, then choose it here — until then this service cannot be booked.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {resources.map((resource) => {
              const chosen = draft.resourceIds.includes(resource.id);
              return (
                <label
                  key={resource.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                    'has-focus-visible:ring-2 has-focus-visible:ring-ring',
                    chosen ? 'border-primary bg-primary/10 font-medium' : 'border-border hover:bg-accent',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={chosen}
                    onChange={() => toggle(resource.id)}
                  />
                  {resource.name}
                </label>
              );
            })}
          </div>
        </fieldset>
        {service ? (
          <p className="text-xs text-muted-foreground">
            Changing the length does not move bookings already made: each keeps the time it was booked with.
          </p>
        ) : null}
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
