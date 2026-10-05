import {
  BOOKING_HOLDING_STATUSES,
  bookingTimes,
  freeSlotStarts,
  holdsSlot,
  rangesOverlap,
} from '../src/domain/slots.js';

const at = (iso: string) => new Date(iso);
const HOUR = { durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
/** 9:00 to 12:00 in Manila is 01:00 to 04:00 UTC. */
const MORNING = [{ startMinute: 540, endMinute: 720 }];
const LONG_AGO = at('2020-01-01T00:00:00Z');

function starts(input: Partial<Parameters<typeof freeSlotStarts>[0]> = {}): string[] {
  return freeSlotStarts({
    day: '2026-10-05',
    timeZone: 'Asia/Manila',
    windows: MORNING,
    service: HOUR,
    busy: [],
    slotMinutes: 30,
    now: LONG_AGO,
    ...input,
  }).map((start) => start.toISOString().slice(11, 16));
}

describe('which bookings hold a slot', () => {
  it('⚠ a pending request holds its slot while it waits', () => {
    expect(holdsSlot('pending')).toBe(true);
  });

  it('holds while confirmed, arrived and done; lets go when declined, cancelled or a no-show', () => {
    expect(['confirmed', 'arrived', 'done'].every((status) => holdsSlot(status as 'done'))).toBe(true);
    expect(['declined', 'cancelled', 'no_show'].some((status) => holdsSlot(status as 'declined'))).toBe(false);
  });

  it('⚠ is the list the migration’s exclusion constraint is written with', () => {
    // Changing this means a new migration for `booking_appointment_no_overlap`.
    expect([...BOOKING_HOLDING_STATUSES]).toEqual(['pending', 'confirmed', 'arrived', 'done']);
  });
});

describe('bookingTimes', () => {
  it('blocks the resource for the service’s time and its buffers', () => {
    const times = bookingTimes(at('2026-10-05T02:00:00Z'), {
      durationMinutes: 60,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 15,
    });
    expect(times.endsAt.toISOString()).toBe('2026-10-05T03:00:00.000Z');
    expect(times.blockedFrom.toISOString()).toBe('2026-10-05T01:50:00.000Z');
    expect(times.blockedUntil.toISOString()).toBe('2026-10-05T03:15:00.000Z');
  });
});

describe('rangesOverlap', () => {
  const ten = { from: at('2026-10-05T02:00:00Z'), until: at('2026-10-05T03:00:00Z') };

  it('clashes when any time is shared', () => {
    expect(rangesOverlap(ten, { from: at('2026-10-05T02:30:00Z'), until: at('2026-10-05T03:30:00Z') })).toBe(true);
    expect(rangesOverlap(ten, { from: at('2026-10-05T01:00:00Z'), until: at('2026-10-05T04:00:00Z') })).toBe(true);
  });

  it('⚠ does not clash when one ends as the other starts', () => {
    expect(rangesOverlap(ten, { from: at('2026-10-05T03:00:00Z'), until: at('2026-10-05T04:00:00Z') })).toBe(false);
    expect(rangesOverlap(ten, { from: at('2026-10-05T01:00:00Z'), until: at('2026-10-05T02:00:00Z') })).toBe(false);
  });
});

describe('freeSlotStarts', () => {
  it('offers every start the whole service fits before closing', () => {
    expect(starts()).toEqual(['01:00', '01:30', '02:00', '02:30', '03:00']);
  });

  it('steps by the workspace’s slot size', () => {
    expect(starts({ slotMinutes: 60 })).toEqual(['01:00', '02:00', '03:00']);
  });

  it('counts from each window’s own opening', () => {
    expect(starts({ windows: [{ startMinute: 555, endMinute: 720 }], slotMinutes: 60 })).toEqual(['01:15', '02:15']);
  });

  it('⚠ offers nothing that overlaps a booking already made', () => {
    const busy = [{ from: at('2026-10-05T02:00:00Z'), until: at('2026-10-05T03:00:00Z') }];
    // 01:00 ends as the booking starts, and 03:00 starts as it ends: both are free.
    expect(starts({ busy })).toEqual(['01:00', '03:00']);
  });

  it('⚠ keeps the buffers clear on both sides', () => {
    const service = { durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 30 };
    const busy = [{ from: at('2026-10-05T02:00:00Z'), until: at('2026-10-05T03:30:00Z') }];
    // A 01:00 start would be blocked until 02:30, into the booking. Nothing after it fits before noon.
    expect(starts({ service, busy })).toEqual([]);
    expect(starts({ service, busy: [] })).toEqual(['01:00', '01:30', '02:00', '02:30', '03:00']);
  });

  it('offers nothing that has already started', () => {
    expect(starts({ now: at('2026-10-05T02:00:00Z') })).toEqual(['02:30', '03:00']);
  });

  it('⚠ is the same wall times in another zone, at other instants', () => {
    // 9:00 to 12:00 in London (BST, UTC+1) is 08:00 to 11:00 UTC.
    expect(starts({ timeZone: 'Europe/London', slotMinutes: 60 })).toEqual(['08:00', '09:00', '10:00']);
  });

  it('offers nothing on a closed day, or for a service longer than the window', () => {
    expect(starts({ windows: [] })).toEqual([]);
    expect(starts({ service: { ...HOUR, durationMinutes: 240 } })).toEqual([]);
  });
});
