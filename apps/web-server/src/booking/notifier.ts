import type { BookingCustomerNotice, BookingNotifier, BookingStartingSoonNotice } from '@kwtech/module-booking/server';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from '@kwtech/module-kit';
import type { NotificationSender } from '@kwtech/module-notification/server';

/**
 * `module-booking`'s notifier, spoken as notifications (`module-notification`'s
 * recipe). The module says what happened — a booking is about to start, a
 * customer asked for one, cancelled or moved theirs — and this chooses the
 * words, the severity and the source.
 *
 * ⚠ STAFF ONLY, and the words name the customer: the recipients are the member
 * the booking is with, or the people who work the desk, all of whom can read
 * the day. Nothing here reaches a customer (BOOKING-PLAN D3, PLAN §12.91).
 *
 * The button opens the workspace's Apps page: there is no link to one booking
 * yet (a sub-app has no route of its own — PLAN §12.80's gap, for booking too).
 */
export class BookingNotifierAdapter implements BookingNotifier {
  constructor(private readonly sender: NotificationSender) {}

  /**
   * Sent by the `booking.upcoming_sessions` background process, not by a
   * person. `warning` rather than `info`: it asks somebody to be ready now.
   *
   * ⚠ The time is printed in the WORKSPACE's zone, handed over with the notice:
   * a notification is read anywhere, and "at 2:30 PM" has to be the shop's 2:30.
   */
  async startingSoon(event: BookingStartingSoonNotice): Promise<void> {
    await this.send(event, {
      severity: 'warning',
      title: `Starting at ${timeOf(event)}: ${event.customerName}`,
      source: 'booking.upcoming',
    });
  }

  /**
   * A customer asked for a booking on the public page. `warning`: it holds a
   * time until somebody answers it, and the customer is waiting to hear.
   */
  async requestWaiting(event: BookingCustomerNotice): Promise<void> {
    await this.send(event, {
      severity: 'warning',
      title: `Booking request to confirm: ${event.customerName}`,
      source: 'booking.request',
      // A busy page folds into one unread row for the workspace.
      group: { key: `booking:${event.workspaceId}:requests`, title: '{count} booking requests to confirm' },
    });
  }

  async customerCancelled(event: BookingCustomerNotice): Promise<void> {
    await this.send(event, {
      severity: 'info',
      title: `Cancelled by the customer: ${event.customerName}`,
      source: 'booking.customer',
    });
  }

  /** The booking is waiting to be confirmed again, at the new time (D8). */
  async customerRescheduled(event: BookingCustomerNotice): Promise<void> {
    await this.send(event, {
      severity: 'warning',
      title: `Moved by the customer, to confirm again: ${event.customerName}`,
      source: 'booking.customer',
    });
  }

  /** One shape for every notice: what, with whom and WHEN — the day as well as the time, in the workspace's zone. */
  private async send(
    event: BookingStartingSoonNotice,
    words: {
      severity: 'info' | 'warning';
      title: string;
      source: string;
      group?: { key: string; title: string };
    },
  ): Promise<void> {
    await this.sender.sendSafely({
      recipientIds: event.recipientIds,
      severity: words.severity,
      title: words.title,
      body: `${event.serviceName}, with ${event.resourceName} — ${dayAndTimeOf(event)}.`,
      source: words.source,
      context: { scope: 'workspace', organizationId: event.organizationId, workspaceId: event.workspaceId },
      actions: [{ kind: 'link', key: 'open', label: 'Open bookings', href: appsHref(event), target: 'self' }],
      ...(words.group ? { group: words.group } : {}),
    });
  }
}

/** ⚠ Never UTC for a zone that cannot be read: the notice would print the wrong hour. */
function zoneOf(event: Pick<BookingStartingSoonNotice, 'timeZone'>): string {
  return isValidTimeZone(event.timeZone) ? event.timeZone : DEFAULT_TIME_ZONE;
}

function timeOf(event: Pick<BookingStartingSoonNotice, 'startsAt' | 'timeZone'>): string {
  return new Date(event.startsAt).toLocaleTimeString('en-US', {
    timeZone: zoneOf(event),
    hour: 'numeric',
    minute: '2-digit',
  });
}

function dayAndTimeOf(event: Pick<BookingStartingSoonNotice, 'startsAt' | 'timeZone'>): string {
  return new Date(event.startsAt).toLocaleString('en-US', {
    timeZone: zoneOf(event),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The workspace's Apps page — `module-app-hub`'s `appHubHref`, restated because
 * the app's server may not import a module's React entry point.
 */
function appsHref(event: Pick<BookingStartingSoonNotice, 'organizationId' | 'workspaceId'>): string {
  return `/organizations/${encodeURIComponent(event.organizationId)}/workspaces/${encodeURIComponent(event.workspaceId)}/apps`;
}
