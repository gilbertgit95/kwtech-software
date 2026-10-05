import { isSlotConflict } from '../src/server/booking.errors.js';
import { ANA, BEN, book, DAY, harness, MANILA, manila, OTHER_WORKSPACE, SCOPE, shop } from './harness.js';

/** The refusal a promise ends in — the reason, never only "it threw". */
async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { reason?: string }).reason ?? `threw without a reason: ${(error as Error).message}`;
  }
  return 'was not refused';
}

describe('making a booking', () => {
  it('⚠ is confirmed as it is made, by staff (D6)', async () => {
    const h = harness();
    const ids = await shop(h);
    const made = await book(h, ids, '10:00');
    expect(made.status).toBe('confirmed');
    expect(made.createdById).toBe(ANA);
    expect(made.endsAt.toISOString()).toBe(manila('11:00'));
  });

  it('writes the first line of its history', async () => {
    const h = harness();
    const made = await book(h, await shop(h), '10:00');
    const found = await h.reads.appointment(SCOPE, made.id);
    expect(found?.changes.map((change) => [change.kind, change.actorKind, change.actorId])).toEqual([
      ['created', 'staff', ANA],
    ]);
  });

  it('copies the customer onto the booking, with no shared record yet (D5)', async () => {
    const h = harness();
    const ids = await shop(h);
    const made = await h.writes.create(SCOPE, ANA, {
      ...ids,
      startsAt: manila('10:00'),
      customerName: 'Maria Santos',
      customerPhone: '0917 555 0100',
      customerEmail: 'maria@example.com',
      note: 'Two copies',
    });
    expect(made).toMatchObject({
      customerName: 'Maria Santos',
      customerPhone: '0917 555 0100',
      customerEmail: 'maria@example.com',
      customerId: null,
      note: 'Two copies',
    });
  });

  it('⚠ refuses a second booking of the same time', async () => {
    const h = harness();
    const ids = await shop(h);
    await book(h, ids, '10:00');
    expect(await refusal(book(h, ids, '10:00'))).toBe('slot_taken');
  });

  it('⚠ refuses one that overlaps by a minute, and takes one that starts as the other ends', async () => {
    const h = harness();
    const ids = await shop(h);
    await book(h, ids, '10:00');
    expect(await refusal(book(h, ids, '10:59'))).toBe('slot_taken');
    expect(await refusal(book(h, ids, '09:01'))).toBe('slot_taken');
    expect((await book(h, ids, '11:00')).status).toBe('confirmed');
  });

  it('⚠ keeps the buffer clear: the next booking cannot start inside it', async () => {
    const h = harness();
    const ids = await shop(h, { bufferAfterMinutes: 30 });
    await book(h, ids, '10:00');
    expect(await refusal(book(h, ids, '11:00'))).toBe('slot_taken');
    expect((await book(h, ids, '11:30')).status).toBe('confirmed');
  });

  it('lets two resources be booked at one time', async () => {
    const h = harness();
    const ids = await shop(h);
    const second = await h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Chair 2', kind: 'place' });
    await h.catalogue.setResourceHours(SCOPE, ANA, second.resource.id, [
      { weekday: 1, startMinute: 0, endMinute: 1440 },
    ]);
    await h.catalogue.saveService(SCOPE, ANA, ids.serviceId, {
      name: 'Consultation',
      durationMinutes: 60,
      resourceIds: [ids.resourceId, second.resource.id],
    });
    await book(h, ids, '10:00');
    // 3 March 2031 is a Monday.
    expect((await book(h, { ...ids, resourceId: second.resource.id }, '10:00')).status).toBe('confirmed');
  });

  it('⚠ a PENDING request holds its slot against a new booking (D2)', async () => {
    const h = harness();
    const ids = await shop(h);
    const made = await book(h, ids, '10:00');
    // What the public link will write: the same booking, waiting for staff.
    const row = h.prisma.state.bookingAppointment.find((candidate) => candidate.id === made.id);
    if (row) row.status = 'pending';
    expect(await refusal(book(h, ids, '10:30'))).toBe('slot_taken');
  });

  it('gives the time back when a booking is cancelled, and when a request is declined', async () => {
    const h = harness();
    const ids = await shop(h);
    const first = await book(h, ids, '10:00');
    await h.writes.cancel(SCOPE, ANA, first.id, 'Customer called');
    const second = await book(h, ids, '10:00');
    const row = h.prisma.state.bookingAppointment.find((candidate) => candidate.id === second.id);
    if (row) row.status = 'pending';
    await h.writes.decline(SCOPE, ANA, second.id, null);
    expect((await book(h, ids, '10:00')).status).toBe('confirmed');
  });

  it('⚠ the database refuses a double booking even when the service’s own look is skipped', async () => {
    const h = harness();
    const ids = await shop(h);
    const made = await book(h, ids, '10:00');
    const { id: _id, ...copy } = made;
    // Two writes that raced past the look: the constraint is what is left.
    const raced = h.prisma.bookingAppointment.create({ data: { ...copy, createdById: BEN } });
    await expect(raced).rejects.toMatchObject({ code: '23P01' });
    expect(isSlotConflict(await raced.catch((error: unknown) => error))).toBe(true);
  });

  it('refuses a time outside the opening hours, and one that runs past closing', async () => {
    const h = harness();
    const ids = await shop(h);
    expect(await refusal(book(h, ids, '08:00'))).toBe('outside_hours');
    expect(await refusal(book(h, ids, '16:30'))).toBe('outside_hours');
    expect((await book(h, ids, '16:00')).status).toBe('confirmed');
  });

  it('⚠ refuses a closed day, for one resource and for the whole workspace', async () => {
    const h = harness();
    const ids = await shop(h);
    await h.catalogue.addException(SCOPE, ANA, { day: DAY, resourceId: ids.resourceId, note: 'Day off' });
    expect(await refusal(book(h, ids, '10:00'))).toBe('outside_hours');
    await h.catalogue.addException(SCOPE, ANA, { day: '2031-03-04', note: 'Holiday' });
    expect(await refusal(book(h, ids, '10:00', '2031-03-04'))).toBe('outside_hours');
    expect((await book(h, ids, '10:00', '2031-03-05')).status).toBe('confirmed');
  });

  it('⚠ reads the hours in the WORKSPACE’s zone: 9:00 in London is not 9:00 in Manila', async () => {
    const h = harness({ timeZone: 'Europe/London' });
    const ids = await shop(h);
    // 10:00 in Manila is 02:00 in London — the shop is shut.
    expect(await refusal(book(h, ids, '10:00'))).toBe('outside_hours');
    const made = await h.writes.create(SCOPE, ANA, {
      ...ids,
      startsAt: `${DAY}T10:00:00+00:00`,
      customerName: 'Maria Santos',
    });
    expect(made.status).toBe('confirmed');
  });

  it('refuses a time already gone, a time with no zone, and a booking for nobody', async () => {
    const h = harness();
    const ids = await shop(h);
    const create = (patch: object) =>
      h.writes.create(SCOPE, ANA, { ...ids, startsAt: manila('10:00'), customerName: 'Maria', ...patch });
    expect(await refusal(create({ startsAt: '2020-03-03T02:00:00Z' }))).toBe('in_the_past');
    expect(await refusal(create({ startsAt: `${DAY}T10:00:00` }))).toBe('invalid_time');
    expect(await refusal(create({ customerName: ' ' }))).toBe('invalid_customer_name');
  });

  it('refuses an archived service, an archived resource, and a resource that does not perform the service', async () => {
    const h = harness();
    const ids = await shop(h);
    const other = await h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Printer', kind: 'equipment' });
    expect(await refusal(book(h, { ...ids, resourceId: other.resource.id }, '10:00'))).toBe('resource_cannot_perform');

    await h.catalogue.setResourceArchived(SCOPE, ANA, ids.resourceId, true);
    expect(await refusal(book(h, ids, '10:00'))).toBe('resource_archived');
    await h.catalogue.setResourceArchived(SCOPE, ANA, ids.resourceId, false);
    await h.catalogue.setServiceArchived(SCOPE, ANA, ids.serviceId, true);
    expect(await refusal(book(h, ids, '10:00'))).toBe('service_archived');
  });

  it('⚠ finds a service and a resource in THIS workspace only', async () => {
    const h = harness();
    const ids = await shop(h);
    const elsewhere = h.writes.create(OTHER_WORKSPACE, ANA, {
      ...ids,
      startsAt: manila('10:00'),
      customerName: 'Maria',
    });
    expect(await refusal(elsewhere)).toBe('not_found');
  });

  it('publishes after the commit, with ids and never a name', async () => {
    const h = harness();
    const made = await book(h, await shop(h), '10:00');
    expect(h.pubsub.sent.at(-1)).toEqual({ ...SCOPE, change: 'appointment', appointmentId: made.id, actorId: ANA });
  });
});

describe('moving a booking', () => {
  it('⚠ is the SAME booking at a new time, with where it moved from (D7)', async () => {
    const h = harness();
    const ids = await shop(h);
    const made = await book(h, ids, '10:00');
    const moved = await h.writes.reschedule(SCOPE, BEN, made.id, manila('14:00'), ids.resourceId);
    expect(moved.id).toBe(made.id);
    expect(moved.status).toBe('confirmed');
    expect(moved.startsAt.toISOString()).toBe(manila('14:00'));
    expect(moved.blockedUntil.toISOString()).toBe(manila('15:00'));

    const found = await h.reads.appointment(SCOPE, made.id);
    const last = found?.changes.at(-1);
    expect([last?.kind, last?.actorId, last?.fromStartsAt?.toISOString(), last?.toStartsAt?.toISOString()]).toEqual([
      'rescheduled',
      BEN,
      manila('10:00'),
      manila('14:00'),
    ]);
  });

  it('frees the old time and takes the new one', async () => {
    const h = harness();
    const ids = await shop(h);
    const made = await book(h, ids, '10:00');
    await h.writes.reschedule(SCOPE, ANA, made.id, manila('14:00'), ids.resourceId);
    expect((await book(h, ids, '10:00')).status).toBe('confirmed');
    expect(await refusal(book(h, ids, '14:30'))).toBe('slot_taken');
  });

  it('⚠ is checked like a new booking: it cannot move onto another one', async () => {
    const h = harness();
    const ids = await shop(h);
    const first = await book(h, ids, '10:00');
    await book(h, ids, '14:00');
    expect(await refusal(h.writes.reschedule(SCOPE, ANA, first.id, manila('14:30'), ids.resourceId))).toBe(
      'slot_taken',
    );
  });

  it('⚠ a refused move leaves the booking where it was, with no line of history', async () => {
    const h = harness();
    const ids = await shop(h);
    const first = await book(h, ids, '10:00');
    await book(h, ids, '14:00');
    await refusal(h.writes.reschedule(SCOPE, ANA, first.id, manila('14:30'), ids.resourceId));
    const found = await h.reads.appointment(SCOPE, first.id);
    expect(found?.appointment.startsAt.toISOString()).toBe(manila('10:00'));
    expect(found?.changes.map((change) => change.kind)).toEqual(['created']);
  });

  it('does not clash with itself: half an hour later overlaps only its own old time', async () => {
    const h = harness();
    const ids = await shop(h);
    const made = await book(h, ids, '10:00');
    const moved = await h.writes.reschedule(SCOPE, ANA, made.id, manila('10:30'), ids.resourceId);
    expect(moved.startsAt.toISOString()).toBe(manila('10:30'));
  });

  it('writes nothing when it is moved to where it already is', async () => {
    const h = harness();
    const ids = await shop(h);
    const made = await book(h, ids, '10:00');
    await h.writes.reschedule(SCOPE, ANA, made.id, manila('10:00'), ids.resourceId);
    expect((await h.reads.appointment(SCOPE, made.id))?.changes).toHaveLength(1);
  });

  it('obeys the opening hours and the closed days at the new time', async () => {
    const h = harness();
    const ids = await shop(h);
    const made = await book(h, ids, '10:00');
    expect(await refusal(h.writes.reschedule(SCOPE, ANA, made.id, manila('18:00'), ids.resourceId))).toBe(
      'outside_hours',
    );
  });

  it('refuses to move a booking that has begun or is over', async () => {
    const h = harness();
    const ids = await shop(h);
    const made = await book(h, ids, '10:00');
    await h.writes.mark(SCOPE, ANA, made.id, 'arrived');
    expect(await refusal(h.writes.reschedule(SCOPE, ANA, made.id, manila('14:00'), ids.resourceId))).toBe(
      'wrong_status',
    );
  });
});

describe('a booking’s status', () => {
  it('⚠ cancelling keeps the booking, with who cancelled it and why (D7)', async () => {
    const h = harness();
    const made = await book(h, await shop(h), '10:00');
    const cancelled = await h.writes.cancel(SCOPE, BEN, made.id, ' Customer called ');
    expect(cancelled.status).toBe('cancelled');
    const last = (await h.reads.appointment(SCOPE, made.id))?.changes.at(-1);
    expect([last?.kind, last?.actorId, last?.reason]).toEqual(['cancelled', BEN, 'Customer called']);
    expect(h.prisma.state.bookingAppointment).toHaveLength(1);
  });

  it('refuses to cancel without a reason', async () => {
    const h = harness();
    const made = await book(h, await shop(h), '10:00');
    expect(await refusal(h.writes.cancel(SCOPE, ANA, made.id, '  '))).toBe('invalid_reason');
  });

  it('marks arrived, then done', async () => {
    const h = harness();
    const made = await book(h, await shop(h), '10:00');
    expect((await h.writes.mark(SCOPE, ANA, made.id, 'arrived')).status).toBe('arrived');
    expect((await h.writes.mark(SCOPE, ANA, made.id, 'done')).status).toBe('done');
    const kinds = (await h.reads.appointment(SCOPE, made.id))?.changes.map((change) => change.kind);
    expect(kinds).toEqual(['created', 'arrived', 'done']);
  });

  it('⚠ refuses a no-show before the booking’s time has come', async () => {
    const h = harness();
    const made = await book(h, await shop(h), '10:00');
    expect(await refusal(h.writes.mark(SCOPE, ANA, made.id, 'no_show'))).toBe('too_early');
  });

  it('refuses a mark that is not one, and a step from the wrong place', async () => {
    const h = harness();
    const made = await book(h, await shop(h), '10:00');
    expect(await refusal(h.writes.mark(SCOPE, ANA, made.id, 'cancelled'))).toBe('wrong_status');
    expect(await refusal(h.writes.confirm(SCOPE, ANA, made.id))).toBe('wrong_status');
    await h.writes.cancel(SCOPE, ANA, made.id, 'Mistake');
    expect(await refusal(h.writes.mark(SCOPE, ANA, made.id, 'arrived'))).toBe('wrong_status');
  });

  it('records who confirmed a request, and when', async () => {
    const h = harness();
    const made = await book(h, await shop(h), '10:00');
    const row = h.prisma.state.bookingAppointment.find((candidate) => candidate.id === made.id);
    if (row) row.status = 'pending';
    const confirmed = await h.writes.confirm(SCOPE, BEN, made.id);
    expect([confirmed.status, confirmed.decidedById, confirmed.decidedAt instanceof Date]).toEqual([
      'confirmed',
      BEN,
      true,
    ]);
  });

  it('⚠ answers not found for a booking in another workspace', async () => {
    const h = harness();
    const made = await book(h, await shop(h), '10:00');
    expect(await refusal(h.writes.cancel(OTHER_WORKSPACE, ANA, made.id, 'Probe'))).toBe('not_found');
    expect(await h.reads.appointment(OTHER_WORKSPACE, made.id)).toBeNull();
  });
});

describe('correcting a booking’s details', () => {
  it('changes the customer and the note, and says so in the history', async () => {
    const h = harness();
    const made = await book(h, await shop(h), '10:00');
    const changed = await h.writes.updateDetails(SCOPE, ANA, made.id, {
      customerName: 'Maria S. Cruz',
      customerPhone: '0917 555 0100',
    });
    expect([changed.customerName, changed.customerPhone]).toEqual(['Maria S. Cruz', '0917 555 0100']);
    expect((await h.reads.appointment(SCOPE, made.id))?.changes.at(-1)?.kind).toBe('details');
  });

  it('refuses once the booking is over', async () => {
    const h = harness();
    const made = await book(h, await shop(h), '10:00');
    await h.writes.cancel(SCOPE, ANA, made.id, 'Mistake');
    expect(await refusal(h.writes.updateDetails(SCOPE, ANA, made.id, { customerName: 'Maria' }))).toBe('wrong_status');
  });
});

describe('isSlotConflict', () => {
  it('reads the exclusion violation wherever the driver puts it', () => {
    expect(isSlotConflict({ code: '23P01' })).toBe(true);
    // What Prisma 7 raises with the pg adapter.
    expect(isSlotConflict({ code: 'P2039' })).toBe(true);
    expect(isSlotConflict({ code: 'P2010', meta: { code: '23P01' } })).toBe(true);
    expect(
      isSlotConflict(new Error('conflicting key value violates exclusion constraint "booking_appointment_no_overlap"')),
    ).toBe(true);
    expect(isSlotConflict({ message: 'failed', cause: { code: '23P01' } })).toBe(true);
  });

  it('is not every database error', () => {
    expect(isSlotConflict({ code: 'P2002' })).toBe(false);
    expect(isSlotConflict(new Error('connection refused'))).toBe(false);
    expect(isSlotConflict(null)).toBe(false);
  });
});

it('the harness runs on Manila time when no zone is bound', () => {
  expect(MANILA).toBe('Asia/Manila');
});
