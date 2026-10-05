'use client';

import { ConfirmDialog, cn } from '@kwtech/web-ui/react';
import {
  Archive,
  ArchiveRestore,
  Box,
  CalendarOff,
  Clock,
  type LucideIcon,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  User,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { type FormEvent, useCallback, useState } from 'react';
import { BOOKING_NAME_MAX, prepareBookingResource } from '../../domain/catalogue.js';
import { BOOKING_EXCEPTION_NOTE_MAX, prepareBookingException } from '../../domain/hours.js';
import { workspaceBookingDay } from '../../domain/time.js';
import type { BookingExceptionView, BookingResourceView } from '../booking-client.js';
import type { BookingAppState } from '../booking-state.js';
import { useBookingAction, useBookingData } from '../use-booking-data.js';
import { RESOURCE_KIND_OPTIONS, resourceKindLabel } from '../view/day.js';
import {
  addStretch,
  canAddStretch,
  copyToOpenDays,
  type DayHoursDraft,
  dayHoursError,
  removeStretch,
  setStretch,
  toggleDay,
  weekDraft,
  weekdayName,
  weekSummary,
  weekWindows,
} from '../view/hours.js';
import { dayText, minutesText, minutesToTimeValue, timeValueToMinutes } from '../view/time.js';
import { buttonClass, Field, FORM_FOOTER_CLASS, INPUT_CLASS, Modal } from './controls.js';
import { Alert, Empty, EmptyState, StatusChip } from './layout.js';

/** A picture for each kind of resource, so a list of them is told apart at a glance. */
const KIND_ICONS: Readonly<Record<string, LucideIcon>> = { staff: User, place: MapPin, equipment: Wrench };

type Editing =
  | { kind: 'resource'; resource: BookingResourceView | null }
  | { kind: 'hours'; resource: BookingResourceView };

/**
 * Resources (BOOKING-PLAN §2): who or what is booked — staff, a place, a piece
 * of equipment — each with its own opening hours, and the days that are closed.
 *
 * ⚠ Changing hours, closing a day or archiving a resource changes what is
 * OFFERED from now on. Bookings already made stay: the desk moves or cancels
 * each one itself, because the app cannot tell the customer.
 */
export function ResourcesSection({ state }: { state: BookingAppState }) {
  const { client, scope } = state;
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const load = useCallback(() => client.catalogue(scope, showArchived), [client, scope, showArchived]);
  const list = useBookingData(scope, load, ['catalogue'], 'Could not load the resources.');
  const action = useBookingAction('Could not change the resource.');
  const resources = list.data?.resources ?? [];

  const setArchived = async (resource: BookingResourceView, archived: boolean) => {
    if (await action.run(() => client.setResourceArchived(scope, resource.id, archived))) await list.reload();
  };
  const saved = async () => {
    setEditing(null);
    await list.reload();
  };

  const addResource = (
    <button
      type="button"
      className={buttonClass('primary')}
      onClick={() => setEditing({ kind: 'resource', resource: null })}
    >
      <Plus aria-hidden="true" className="size-4" />
      Add a resource
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-1">
      <section className="flex flex-col gap-3" aria-label="Resources">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-lg font-semibold tracking-tight">Resources</h2>
            <p className="text-sm text-muted-foreground">
              Who or what gets booked — a person, a counter, a machine — and when each is open.
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
            {addResource}
          </div>
        </header>
        <Alert message={list.error ?? action.error} onDismiss={action.error ? action.dismissError : undefined} />
        {list.data === null && !list.error ? <Empty>Loading the resources…</Empty> : null}
        {list.data !== null && resources.length === 0 ? (
          <EmptyState icon={UsersRound} title="No resources yet" action={addResource}>
            Add the first person, place or piece of equipment customers book, then set its opening hours.
          </EmptyState>
        ) : null}
        <ul className="m-0 grid list-none auto-rows-min gap-3 p-0 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {resources.map((resource) => {
            const KindIcon = KIND_ICONS[resource.kind] ?? Box;
            const closed = resource.hours.length === 0;
            return (
              <li
                key={resource.id}
                className={cn(
                  'flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs',
                  resource.archivedAt ? 'opacity-70' : null,
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <KindIcon aria-hidden="true" className="size-5" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <h3 className="truncate text-base font-semibold">{resource.name}</h3>
                    <p className="truncate text-xs text-muted-foreground">
                      {resourceKindLabel(resource.kind)}
                      {resource.userName ? ` · ${resource.userName}` : ''}
                    </p>
                  </div>
                  {resource.archivedAt ? <StatusChip label="Archived" tone="neutral" /> : null}
                </div>
                <p
                  className={cn(
                    'flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs',
                    closed ? 'bg-status-warning text-status-warning-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Clock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>{weekSummary(resource.hours)}</span>
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <button
                    type="button"
                    className={buttonClass(closed ? 'primary' : 'secondary', 'sm')}
                    disabled={resource.archivedAt !== null}
                    onClick={() => setEditing({ kind: 'hours', resource })}
                  >
                    <Clock aria-hidden="true" className="size-3.5" />
                    {closed ? 'Set hours' : 'Hours'}
                    <span className="sr-only"> of {resource.name}</span>
                  </button>
                  <button
                    type="button"
                    className={buttonClass('secondary', 'sm')}
                    onClick={() => setEditing({ kind: 'resource', resource })}
                  >
                    <Pencil aria-hidden="true" className="size-3.5" />
                    Edit<span className="sr-only"> {resource.name}</span>
                  </button>
                  <button
                    type="button"
                    className={cn(buttonClass('ghost', 'sm'), 'ml-auto')}
                    disabled={action.busy}
                    onClick={() => setArchived(resource, resource.archivedAt === null)}
                  >
                    {resource.archivedAt ? (
                      <ArchiveRestore aria-hidden="true" className="size-3.5" />
                    ) : (
                      <Archive aria-hidden="true" className="size-3.5" />
                    )}
                    {resource.archivedAt ? 'Restore' : 'Archive'}
                    <span className="sr-only"> {resource.name}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <ClosedDays state={state} resources={resources.filter((resource) => resource.archivedAt === null)} />

      {editing?.kind === 'resource' ? (
        <ResourceForm state={state} resource={editing.resource} onClose={() => setEditing(null)} onSaved={saved} />
      ) : null}
      {editing?.kind === 'hours' ? (
        <HoursForm state={state} resource={editing.resource} onClose={() => setEditing(null)} onSaved={saved} />
      ) : null}
    </div>
  );
}

function ResourceForm({
  state,
  resource,
  onClose,
  onSaved,
}: {
  state: BookingAppState;
  resource: BookingResourceView | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { client, scope } = state;
  const [name, setName] = useState(resource?.name ?? '');
  const [kind, setKind] = useState(resource?.kind ?? 'staff');
  const [userId, setUserId] = useState(resource?.userId ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const action = useBookingAction('Could not save the resource.');
  const loadMembers = useCallback(() => client.members(scope), [client, scope]);
  const members = useBookingData(scope, loadMembers, [], 'Could not load the members.');
  const hint = RESOURCE_KIND_OPTIONS.find((option) => option.value === kind)?.hint;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = { name, kind, userId: kind === 'staff' && userId ? userId : null };
    const prepared = prepareBookingResource(input);
    if ('refused' in prepared && prepared.refused === 'invalid_name') {
      setNameError('Give the resource a name.');
      return;
    }
    setNameError(null);
    if (await action.run(() => client.saveResource(scope, resource?.id ?? null, input))) await onSaved();
  }

  return (
    <Modal open title={resource ? 'Change the resource' : 'Add a resource'} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <Alert message={action.error} onDismiss={action.dismissError} />
        <Field label="Name" error={nameError}>
          {(id, describedBy) => (
            <input
              id={id}
              // biome-ignore lint/a11y/noAutofocus: the form opens on its first field, not on Close.
              autoFocus
              className={INPUT_CLASS}
              value={name}
              maxLength={BOOKING_NAME_MAX}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={describedBy}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Kind" hint={hint}>
          {(id, describedBy) => (
            <select
              id={id}
              className={INPUT_CLASS}
              value={kind}
              aria-describedby={describedBy}
              onChange={(event) => setKind(event.target.value)}
            >
              {RESOURCE_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        {kind === 'staff' ? (
          <Field
            label="Member"
            hint={
              members.error ??
              'Optional. Linked, they are the one reminded of their bookings; otherwise everybody at the desk is.'
            }
          >
            {(id, describedBy) => (
              <select
                id={id}
                className={INPUT_CLASS}
                value={userId}
                aria-describedby={describedBy}
                onChange={(event) => setUserId(event.target.value)}
              >
                <option value="">Nobody — not a member here</option>
                {/* Somebody linked who no longer works the desk is still shown, so saving does not silently unlink them. */}
                {resource?.userId && !(members.data ?? []).some((member) => member.userId === resource.userId) ? (
                  <option value={resource.userId}>{resource.userName ?? 'A former member'}</option>
                ) : null}
                {(members.data ?? []).map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        {resource ? null : (
          <p className="text-xs text-muted-foreground">
            A new resource has no opening hours. Set them next, and add it to the services it performs.
          </p>
        )}
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

/**
 * One resource's week: a row per weekday, open or closed, with its stretches.
 * Saved WHOLE — the week on screen replaces the week that was.
 *
 * ⚠ These are the WORKSPACE's clock times. 9:00 is 9:00 in the shop, whatever
 * zone the person setting it is in.
 */
function HoursForm({
  state,
  resource,
  onClose,
  onSaved,
}: {
  state: BookingAppState;
  resource: BookingResourceView;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<DayHoursDraft[]>(() => weekDraft(resource.hours));
  const action = useBookingAction('Could not save the hours.');
  const invalid = draft.some((day) => dayHoursError(day) !== null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (invalid) return;
    if (await action.run(() => state.client.setResourceHours(state.scope, resource.id, weekWindows(draft)))) {
      await onSaved();
    }
  }

  return (
    <Modal open title={`Opening hours of ${resource.name}`} onClose={onClose} wide>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <Alert message={action.error} onDismiss={action.dismissError} />
        <p className="text-xs text-muted-foreground">
          In this workspace’s own time ({state.timeZone.replace(/_/gu, ' ')}). A booking must fit inside one stretch.
        </p>
        <div className="flex flex-col gap-2">
          {draft.map((day) => {
            const error = dayHoursError(day);
            const name = weekdayName(day.weekday);
            return (
              <fieldset
                key={day.weekday}
                className={cn(
                  'm-0 flex flex-col gap-2 rounded-xl border border-border p-3',
                  day.stretches.length === 0 ? 'bg-muted/40' : 'bg-card',
                )}
              >
                <legend className="sr-only">{name}</legend>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex w-28 items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={day.stretches.length > 0}
                      onChange={() => setDraft(toggleDay(draft, day.weekday))}
                    />
                    {name}
                  </label>
                  {day.stretches.length === 0 ? <span className="text-sm text-muted-foreground">Closed</span> : null}
                  {day.stretches.length > 0 ? (
                    <span className="ml-auto flex gap-1.5">
                      {canAddStretch(day) ? (
                        <button
                          type="button"
                          className={buttonClass('ghost', 'sm')}
                          onClick={() => setDraft(addStretch(draft, day.weekday))}
                        >
                          Add a stretch<span className="sr-only"> on {name}</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={buttonClass('ghost', 'sm')}
                        onClick={() => setDraft(copyToOpenDays(draft, day.weekday))}
                      >
                        Copy to open days<span className="sr-only"> from {name}</span>
                      </button>
                    </span>
                  ) : null}
                </div>
                {day.stretches.map((stretch) => (
                  <div key={stretch.key} className="flex flex-wrap items-center gap-2 pl-6">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      From
                      <input
                        type="time"
                        className={`${INPUT_CLASS} w-32`}
                        value={minutesToTimeValue(stretch.startMinute)}
                        aria-invalid={error ? true : undefined}
                        onChange={(event) => {
                          const startMinute = timeValueToMinutes(event.target.value);
                          if (startMinute !== null)
                            setDraft(setStretch(draft, day.weekday, stretch.key, { startMinute }));
                        }}
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      to
                      <input
                        type="time"
                        className={`${INPUT_CLASS} w-32`}
                        // 24:00 is not a time a browser's field can show; midnight ends the day as 23:59 on screen.
                        value={minutesToTimeValue(Math.min(stretch.endMinute, 1439))}
                        aria-invalid={error ? true : undefined}
                        onChange={(event) => {
                          const endMinute = timeValueToMinutes(event.target.value);
                          if (endMinute !== null) setDraft(setStretch(draft, day.weekday, stretch.key, { endMinute }));
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className={buttonClass('ghost', 'sm')}
                      onClick={() => setDraft(removeStretch(draft, day.weekday, stretch.key))}
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                      <span className="sr-only">
                        Remove the stretch starting {minutesText(stretch.startMinute)} on {name}
                      </span>
                    </button>
                  </div>
                ))}
                {error ? (
                  <p role="alert" className="pl-6 text-xs text-destructive">
                    {error}
                  </p>
                ) : null}
              </fieldset>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Bookings already made outside the new hours stay as they are. Move or cancel them from the day.
        </p>
        <footer className={FORM_FOOTER_CLASS}>
          <button type="button" className={buttonClass('ghost')} onClick={onClose} disabled={action.busy}>
            Close
          </button>
          <button type="submit" className={buttonClass('primary')} disabled={action.busy || invalid}>
            {action.busy ? 'Saving…' : 'Save hours'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

/** Closed days and stretches from today on: a holiday for everyone, or a day off for one resource. */
function ClosedDays({ state, resources }: { state: BookingAppState; resources: readonly BookingResourceView[] }) {
  const { client, scope, timeZone } = state;
  const today = workspaceBookingDay(new Date(), timeZone);
  const load = useCallback(() => client.exceptions(scope, today), [client, scope, today]);
  const list = useBookingData(scope, load, ['catalogue'], 'Could not load the closed days.');
  const action = useBookingAction('Could not change the closed days.');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<BookingExceptionView | null>(null);
  const closures = list.data ?? [];
  const nameOf = (resourceId: string | null) =>
    resourceId === null
      ? 'Everything'
      : (resources.find((resource) => resource.id === resourceId)?.name ?? 'An archived resource');

  return (
    <section className="flex flex-col gap-3" aria-label="Closed days">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-lg font-semibold tracking-tight">Closed days</h2>
          <p className="text-sm text-muted-foreground">A holiday for everything, or a day off for one resource.</p>
        </div>
        <button type="button" className={cn(buttonClass('secondary'), 'ml-auto')} onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" className="size-4" />
          Close a day
        </button>
      </header>
      <Alert message={list.error ?? action.error} onDismiss={action.error ? action.dismissError : undefined} />
      {list.data !== null && closures.length === 0 ? (
        <EmptyState icon={CalendarOff} title="No closed days ahead">
          Everything is open on its usual hours.
        </EmptyState>
      ) : null}
      <ul className="m-0 grid list-none auto-rows-min gap-2 p-0 @2xl:grid-cols-2">
        {closures.map((closure) => (
          <li
            key={closure.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm shadow-xs"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <CalendarOff aria-hidden="true" className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">
                {dayText(closure.day)}
                {closure.startMinute !== null && closure.endMinute !== null
                  ? `, ${minutesText(closure.startMinute)} – ${minutesText(closure.endMinute)}`
                  : ''}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {nameOf(closure.resourceId)}
                {closure.note ? ` · ${closure.note}` : ''}
              </span>
            </span>
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setRemoving(closure)}>
              Reopen<span className="sr-only"> {dayText(closure.day)}</span>
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <ClosureForm
          state={state}
          resources={resources}
          today={today}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await list.reload();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        title="Reopen this day?"
        description={
          removing
            ? `${nameOf(removing.resourceId)} can be booked again on ${dayText(removing.day)}, within the opening hours.`
            : ''
        }
        confirmLabel="Reopen"
        danger={false}
        pending={action.busy}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const done = await action.run(() => client.removeException(scope, removing.id));
          setRemoving(null);
          if (done) await list.reload();
        }}
      />
    </section>
  );
}

function ClosureForm({
  state,
  resources,
  today,
  onClose,
  onSaved,
}: {
  state: BookingAppState;
  resources: readonly BookingResourceView[];
  today: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [resourceId, setResourceId] = useState('');
  const [day, setDay] = useState(today);
  const [wholeDay, setWholeDay] = useState(true);
  const [from, setFrom] = useState('12:00');
  const [to, setTo] = useState('13:00');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const action = useBookingAction('Could not close the day.');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = {
      resourceId: resourceId || null,
      day,
      startMinute: wholeDay ? null : timeValueToMinutes(from),
      endMinute: wholeDay ? null : timeValueToMinutes(to),
      note,
    };
    if ('refused' in prepareBookingException(input)) {
      setError('Choose a real day, and a stretch that ends after it starts.');
      return;
    }
    setError(null);
    if (await action.run(() => state.client.addException(state.scope, input))) await onSaved();
  }

  return (
    <Modal open title="Close a day" onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <Alert message={action.error ?? error} onDismiss={action.error ? action.dismissError : undefined} />
        <Field label="Who or what is closed">
          {(id) => (
            <select
              id={id}
              className={INPUT_CLASS}
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
            >
              <option value="">Everything — the whole workspace</option>
              {resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
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
              min={today}
              onChange={(event) => setDay(event.target.value)}
            />
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={wholeDay} onChange={(event) => setWholeDay(event.target.checked)} />
          The whole day
        </label>
        {wholeDay ? null : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              {(id) => (
                <input
                  id={id}
                  type="time"
                  className={INPUT_CLASS}
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              )}
            </Field>
            <Field label="To">
              {(id) => (
                <input
                  id={id}
                  type="time"
                  className={INPUT_CLASS}
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              )}
            </Field>
          </div>
        )}
        <Field label="Why" hint="Optional: “Holiday”, “Machine service”.">
          {(id, describedBy) => (
            <input
              id={id}
              className={INPUT_CLASS}
              value={note}
              maxLength={BOOKING_EXCEPTION_NOTE_MAX}
              aria-describedby={describedBy}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        <p className="text-xs text-muted-foreground">
          Bookings already made on that day stay as they are. Move or cancel them from the day.
        </p>
        <footer className={FORM_FOOTER_CLASS}>
          <button type="button" className={buttonClass('ghost')} onClick={onClose} disabled={action.busy}>
            Close
          </button>
          <button type="submit" className={buttonClass('primary')} disabled={action.busy}>
            {action.busy ? 'Saving…' : 'Close the day'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
