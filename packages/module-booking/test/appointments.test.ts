import {
  type BookingAct,
  canBookingAct,
  checkBookingActTime,
  checkEditDetails,
  checkReschedule,
  nextBookingStatus,
  prepareBookingCustomer,
  prepareBookingReason,
} from '../src/domain/appointments.js';
import {
  BOOKING_DEFAULT_SETTINGS,
  normalizeBookingSettings,
  prepareBookingResource,
  prepareBookingService,
  prepareBookingSettings,
} from '../src/domain/catalogue.js';
import { upcomingSessionRecipients } from '../src/domain/reminders.js';
import type { BookingStatus } from '../src/types.js';

const STATUSES: BookingStatus[] = ['pending', 'confirmed', 'declined', 'arrived', 'done', 'cancelled', 'no_show'];
const ACTS: BookingAct[] = ['confirm', 'decline', 'arrive', 'finish', 'no_show', 'cancel'];

describe('nextBookingStatus', () => {
  it('walks a request from pending to done', () => {
    expect(nextBookingStatus('pending', 'confirm')).toEqual({ status: 'confirmed' });
    expect(nextBookingStatus('confirmed', 'arrive')).toEqual({ status: 'arrived' });
    expect(nextBookingStatus('arrived', 'finish')).toEqual({ status: 'done' });
  });

  it('lets a desk that does not mark arrivals finish a confirmed booking', () => {
    expect(nextBookingStatus('confirmed', 'finish')).toEqual({ status: 'done' });
  });

  it('declines only a request, and frees nothing that was confirmed that way', () => {
    expect(nextBookingStatus('pending', 'decline')).toEqual({ status: 'declined' });
    expect(nextBookingStatus('confirmed', 'decline')).toEqual({ refused: 'wrong_status' });
  });

  it('cancels a booking that is waiting, confirmed or here', () => {
    for (const status of ['pending', 'confirmed', 'arrived'] as const) {
      expect(nextBookingStatus(status, 'cancel')).toEqual({ status: 'cancelled' });
    }
  });

  it('⚠ lets nothing come back from declined, done, cancelled or no-show', () => {
    for (const status of ['declined', 'done', 'cancelled', 'no_show'] as const) {
      for (const act of ACTS) expect([status, act, canBookingAct(status, act)]).toEqual([status, act, false]);
    }
  });

  it('answers for every status and act', () => {
    for (const status of STATUSES) {
      for (const act of ACTS) {
        const next = nextBookingStatus(status, act);
        expect('status' in next || next.refused === 'wrong_status').toBe(true);
      }
    }
  });
});

describe('when an act may be done', () => {
  const startsAt = new Date('2026-10-05T02:00:00Z');

  it('⚠ refuses a no-show before the booking’s time has come', () => {
    expect(checkBookingActTime('no_show', startsAt, new Date('2026-10-05T01:59:00Z'))).toBe('too_early');
    expect(checkBookingActTime('no_show', startsAt, new Date('2026-10-05T02:00:00Z'))).toBeNull();
  });

  it('lets a customer arrive, and finish, early', () => {
    const early = new Date('2026-10-05T01:00:00Z');
    expect(checkBookingActTime('arrive', startsAt, early)).toBeNull();
    expect(checkBookingActTime('finish', startsAt, early)).toBeNull();
  });

  it('moves only a booking that has not begun', () => {
    expect(checkReschedule('pending')).toBeNull();
    expect(checkReschedule('confirmed')).toBeNull();
    for (const status of ['arrived', 'done', 'cancelled', 'declined', 'no_show'] as const) {
      expect(checkReschedule(status)).toBe('wrong_status');
    }
  });

  it('corrects details until the booking is over', () => {
    expect(checkEditDetails('arrived')).toBeNull();
    expect(checkEditDetails('done')).toBe('wrong_status');
    expect(checkEditDetails('cancelled')).toBe('wrong_status');
  });
});

describe('prepareBookingCustomer', () => {
  it('keeps the name, and phone and e-mail as SEPARATE fields', () => {
    expect(
      prepareBookingCustomer({
        customerName: '  Maria   Santos ',
        customerPhone: '+63 917 555 0100',
        customerEmail: 'Maria@Example.com',
        note: 'Tarpaulin, 3×6 ft',
      }),
    ).toEqual({
      customer: {
        customerName: 'Maria Santos',
        customerPhone: '+63 917 555 0100',
        customerEmail: 'maria@example.com',
        note: 'Tarpaulin, 3×6 ft',
      },
    });
  });

  it('takes a name alone', () => {
    expect(prepareBookingCustomer({ customerName: 'Maria' })).toEqual({
      customer: { customerName: 'Maria', customerPhone: null, customerEmail: null, note: '' },
    });
  });

  it('refuses a booking for nobody', () => {
    expect(prepareBookingCustomer({ customerName: '   ' })).toEqual({ refused: 'invalid_customer_name' });
  });

  it('refuses a phone with no digits and an e-mail that is not one', () => {
    expect(prepareBookingCustomer({ customerName: 'Maria', customerPhone: 'call me' })).toEqual({
      refused: 'invalid_phone',
    });
    expect(prepareBookingCustomer({ customerName: 'Maria', customerPhone: '()' })).toEqual({
      refused: 'invalid_phone',
    });
    expect(prepareBookingCustomer({ customerName: 'Maria', customerEmail: 'maria at example' })).toEqual({
      refused: 'invalid_email',
    });
  });

  it('refuses invisible formatting in a name', () => {
    expect(prepareBookingCustomer({ customerName: 'Mar‮ia' })).toEqual({ refused: 'invalid_customer_name' });
  });
});

describe('prepareBookingReason', () => {
  it('⚠ requires a reason to cancel', () => {
    expect(prepareBookingReason('  ', { required: true })).toEqual({ refused: 'invalid_reason' });
    expect(prepareBookingReason('Customer called', { required: true })).toEqual({ reason: 'Customer called' });
  });

  it('lets a decline go unexplained', () => {
    expect(prepareBookingReason(null, { required: false })).toEqual({ reason: '' });
  });
});

describe('prepareBookingService', () => {
  const base = { name: 'Consultation', durationMinutes: 30, resourceIds: ['r1', 'r1', 'r2'] };

  it('defaults the buffers and the price, and drops a repeated resource', () => {
    expect(prepareBookingService(base)).toEqual({
      service: {
        name: 'Consultation',
        durationMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        price: null,
        resourceIds: ['r1', 'r2'],
      },
    });
  });

  it('takes a service with no resources yet', () => {
    expect('service' in prepareBookingService({ ...base, resourceIds: [] })).toBe(true);
  });

  it('refuses a duration that is not an appointment', () => {
    expect(prepareBookingService({ ...base, durationMinutes: 0 })).toEqual({ refused: 'invalid_duration' });
    expect(prepareBookingService({ ...base, durationMinutes: 721 })).toEqual({ refused: 'invalid_duration' });
    expect(prepareBookingService({ ...base, durationMinutes: 22.5 })).toEqual({ refused: 'invalid_duration' });
  });

  it('refuses a negative buffer, a negative price and a nameless service', () => {
    expect(prepareBookingService({ ...base, bufferAfterMinutes: -5 })).toEqual({ refused: 'invalid_buffer' });
    expect(prepareBookingService({ ...base, price: -1 })).toEqual({ refused: 'invalid_price' });
    expect(prepareBookingService({ ...base, name: ' ' })).toEqual({ refused: 'invalid_name' });
  });
});

describe('prepareBookingResource', () => {
  it('links a member to a staff resource', () => {
    expect(prepareBookingResource({ name: 'Ana', kind: 'staff', userId: 'user-ana' })).toEqual({
      resource: { name: 'Ana', kind: 'staff', userId: 'user-ana' },
    });
  });

  it('⚠ drops the link for a place or a machine — only staff is a person', () => {
    expect(prepareBookingResource({ name: 'Room 1', kind: 'place', userId: 'user-ana' })).toEqual({
      resource: { name: 'Room 1', kind: 'place', userId: null },
    });
  });

  it('refuses a kind that names a trade', () => {
    expect(prepareBookingResource({ name: 'Ana', kind: 'stylist' })).toEqual({ refused: 'invalid_kind' });
  });
});

describe('booking settings', () => {
  it('takes a slot size on offer and a reminder of up to a day', () => {
    expect(prepareBookingSettings({ ...BOOKING_DEFAULT_SETTINGS, slotMinutes: 15, reminderMinutes: 0 })).toEqual({
      settings: { ...BOOKING_DEFAULT_SETTINGS, slotMinutes: 15, reminderMinutes: 0 },
    });
  });

  it('refuses a slot size that does not divide an hour, and a reminder longer than a day', () => {
    expect(prepareBookingSettings({ ...BOOKING_DEFAULT_SETTINGS, slotMinutes: 25 })).toEqual({
      refused: 'invalid_settings',
    });
    expect(prepareBookingSettings({ ...BOOKING_DEFAULT_SETTINGS, reminderMinutes: 1441 })).toEqual({
      refused: 'invalid_settings',
    });
  });

  it('⚠ reads a stored value no longer on offer back as its default, never as no slots', () => {
    expect(normalizeBookingSettings({ slotMinutes: 0, reminderMinutes: 45 })).toEqual({
      ...BOOKING_DEFAULT_SETTINGS,
      reminderMinutes: 45,
    });
    expect(normalizeBookingSettings(null)).toEqual(BOOKING_DEFAULT_SETTINGS);
  });

  it('⚠ keeps the public page OFF by default, and off without a title', () => {
    expect(BOOKING_DEFAULT_SETTINGS.publicEnabled).toBe(false);
    expect(prepareBookingSettings({ ...BOOKING_DEFAULT_SETTINGS, publicEnabled: true })).toEqual({
      refused: 'invalid_title',
    });
    const open = prepareBookingSettings({
      ...BOOKING_DEFAULT_SETTINGS,
      publicEnabled: true,
      publicTitle: ' Ana’s Shop ',
    });
    expect('settings' in open ? [open.settings.publicEnabled, open.settings.publicTitle] : open).toEqual([
      true,
      'Ana’s Shop',
    ]);
  });

  it('⚠ reads a stored page that is on back as on — the title is in place before the switch is tried', () => {
    const stored = normalizeBookingSettings({ publicEnabled: true, publicTitle: 'Ana’s Shop', leadMinutes: 30 });
    expect([stored.publicEnabled, stored.publicTitle, stored.leadMinutes]).toEqual([true, 'Ana’s Shop', 30]);
    // And one stored as on with no title — which no write allows — reads as off, not as a nameless page.
    expect(normalizeBookingSettings({ publicEnabled: true }).publicEnabled).toBe(false);
  });

  it('refuses a customer rule out of range', () => {
    for (const patch of [{ leadMinutes: -1 }, { horizonDays: 0 }, { cutoffMinutes: 99999 }, { lapseHours: 0 }]) {
      expect(prepareBookingSettings({ ...BOOKING_DEFAULT_SETTINGS, ...patch })).toEqual({
        refused: 'invalid_settings',
      });
    }
  });
});

describe('upcomingSessionRecipients', () => {
  it('tells the member a staff resource is, and nobody else', () => {
    expect(upcomingSessionRecipients('user-ana', ['user-ana', 'user-ben'])).toEqual(['user-ana']);
  });

  it('tells the whole desk for a place, a machine, or a person with no account', () => {
    expect(upcomingSessionRecipients(null, ['user-ana', 'user-ben'])).toEqual(['user-ana', 'user-ben']);
  });

  it('⚠ never tells a linked member who no longer works the desk', () => {
    expect(upcomingSessionRecipients('user-gone', ['user-ben'])).toEqual(['user-ben']);
    expect(upcomingSessionRecipients('user-gone', [])).toEqual([]);
  });
});
