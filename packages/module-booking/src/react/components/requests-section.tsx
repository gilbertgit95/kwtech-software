'use client';

import { cn, LIST_ITEM, LIST_KEYS, ListDrawer, listNeighbours } from '@kwtech/web-ui/react';
import { Inbox } from 'lucide-react';
import { useState } from 'react';
import type { BookingAppointmentView } from '../booking-client.js';
import type { BookingAppState } from '../booking-state.js';
import type { BookingData } from '../use-booking-data.js';
import { dayAndTime } from '../view/time.js';
import { Avatar, BookingDetail, type BookingDialog } from './day-section.js';
import { Alert, Empty, EmptyState, TONE_MARK_CLASS } from './layout.js';

/**
 * The requests customers made on the public page that are still WAITING for
 * the desk (D2) — every one of them, whatever day it is for, the
 * longest-waiting first.
 *
 * Its own list because the Day shows one day: a request for next week would
 * otherwise be seen only by somebody who happened to open next week, while it
 * holds its time and the customer waits to hear. Opening one is the same
 * drawer as on the Day, with Confirm and Decline.
 */
export function RequestsSection({
  state,
  requests,
}: {
  state: BookingAppState;
  /** Read by the app, which also counts them for the section bar. */
  requests: BookingData<BookingAppointmentView[]>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<BookingDialog>(null);
  const waiting = requests.data ?? [];
  const around = listNeighbours(
    waiting.map((request) => request.id),
    selected,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Alert message={requests.error} />
      <ListDrawer
        label="request"
        onClose={() => setSelected(null)}
        step={{
          onPrevious: around.previous ? () => setSelected(around.previous) : null,
          onNext: around.next ? () => setSelected(around.next) : null,
          position: around.position,
        }}
        list={
          <>
            <header className="flex flex-col">
              <h2 className="text-lg font-semibold tracking-tight">Requests</h2>
              <p className="text-sm text-muted-foreground">
                Asked for on your public booking page. Each holds its time until you confirm or decline it.
              </p>
            </header>
            {requests.data === null && !requests.error ? <Empty>Loading the requests…</Empty> : null}
            {requests.data !== null && waiting.length === 0 ? (
              <EmptyState icon={Inbox} title="Nothing is waiting">
                When a customer asks for a booking on your public page, it shows here to confirm.
              </EmptyState>
            ) : null}
            <ul className="m-0 flex min-h-0 list-none flex-col gap-2 overflow-y-auto p-0 pb-1" {...LIST_KEYS}>
              {waiting.map((request) => (
                <li key={request.id}>
                  <button
                    type="button"
                    {...LIST_ITEM}
                    aria-current={request.id === selected ? 'true' : undefined}
                    className={cn(
                      // ⚠ `relative`: the bar down the edge is positioned against the row, so it scrolls with it.
                      'relative flex w-full items-center gap-3 overflow-hidden rounded-xl border bg-card py-2.5 pr-3 pl-4 text-left shadow-xs transition-colors hover:bg-accent',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      request.id === selected ? 'border-primary bg-accent ring-1 ring-primary' : 'border-border',
                    )}
                    onClick={() => setSelected(request.id)}
                  >
                    <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', TONE_MARK_CLASS.warning)} />
                    <Avatar name={request.customerName} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{request.customerName}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {request.serviceName} · {request.resourceName}
                      </span>
                    </span>
                    {/* The day as well as the time: this list is not one day's. */}
                    <span className="shrink-0 text-right text-xs font-medium tabular-nums">
                      {dayAndTime(request.startsAt, state.timeZone)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        }
        detail={
          selected ? (
            <BookingDetail
              // Remounted per request, so one request's dialog never opens over another.
              key={selected}
              state={state}
              appointmentId={selected}
              dialog={dialog}
              onDialog={setDialog}
              onChanged={requests.reload}
            />
          ) : null
        }
      />
    </div>
  );
}
