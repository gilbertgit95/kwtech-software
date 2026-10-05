import type { LimitChecker } from '@kwtech/module-kit';
import { BOOKING_LIMIT } from '../src/feature-keys.js';
import { ANA, BEN, book, DAY, harness, NINE_TO_FIVE, OTHER_WORKSPACE, SCOPE, shop } from './harness.js';

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { reason?: string }).reason ?? `threw without a reason: ${(error as Error).message}`;
  }
  return 'was not refused';
}

/** A plan that allows `cap` resources, recording what it was asked. */
function capOf(cap: number): LimitChecker & { asked: unknown[] } {
  const checker = {
    asked: [] as unknown[],
    async check(input: { current: number }) {
      checker.asked.push(input);
      return { allowed: input.current < cap, limit: cap, current: input.current, remaining: cap - input.current };
    },
  };
  return checker;
}

describe('services', () => {
  it('creates one, then changes it and replaces its resources', async () => {
    const h = harness();
    const ids = await shop(h);
    const second = await h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Chair 2', kind: 'place' });
    const changed = await h.catalogue.saveService(SCOPE, ANA, ids.serviceId, {
      name: 'Long consultation',
      durationMinutes: 90,
      price: 50000,
      resourceIds: [second.resource.id],
    });
    expect([changed.service.name, changed.service.durationMinutes, changed.service.price]).toEqual([
      'Long consultation',
      90,
      50000,
    ]);
    expect(changed.resourceIds).toEqual([second.resource.id]);
  });

  it('⚠ refuses a resource of another workspace', async () => {
    const h = harness();
    const ids = await shop(h);
    const elsewhere = h.catalogue.saveService(OTHER_WORKSPACE, ANA, null, {
      name: 'Consultation',
      durationMinutes: 60,
      resourceIds: [ids.resourceId],
    });
    expect(await refusal(elsewhere)).toBe('invalid_resources');
    expect(h.prisma.state.bookingService).toHaveLength(1);
  });

  it('answers not found when changing one of another workspace', async () => {
    const h = harness();
    const ids = await shop(h);
    const elsewhere = h.catalogue.saveService(OTHER_WORKSPACE, ANA, ids.serviceId, {
      name: 'Hijacked',
      durationMinutes: 60,
      resourceIds: [],
    });
    expect(await refusal(elsewhere)).toBe('not_found');
  });

  it('⚠ a changed duration does not move a booking already made', async () => {
    const h = harness();
    const ids = await shop(h);
    const made = await book(h, ids, '10:00');
    await h.catalogue.saveService(SCOPE, ANA, ids.serviceId, {
      name: 'Consultation',
      durationMinutes: 120,
      resourceIds: [ids.resourceId],
    });
    const after = (await h.reads.appointment(SCOPE, made.id))?.appointment;
    expect(after?.endsAt.getTime()).toBe(made.endsAt.getTime());
  });
});

describe('resources', () => {
  it('⚠ holds the declared cap when no limit checker is bound — never unlimited', async () => {
    const h = harness();
    for (let i = 0; i < 10; i += 1) {
      await h.catalogue.saveResource(SCOPE, ANA, null, { name: `Chair ${i}`, kind: 'place' });
    }
    expect(await refusal(h.catalogue.saveResource(SCOPE, ANA, null, { name: 'One more', kind: 'place' }))).toBe(
      'limit_reached',
    );
  });

  it('asks the plan for the workspace’s cap, with the live count', async () => {
    const limits = capOf(1);
    const h = harness({ limits });
    await h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Chair 1', kind: 'place' });
    expect(limits.asked).toEqual([{ actorId: ANA, key: BOOKING_LIMIT.resources, current: 0, ...SCOPE }]);
    expect(await refusal(h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Chair 2', kind: 'place' }))).toBe(
      'limit_reached',
    );
  });

  it('⚠ an archived resource frees a place, and restoring it is checked against the cap again', async () => {
    const h = harness({ limits: capOf(1) });
    const first = await h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Chair 1', kind: 'place' });
    await h.catalogue.setResourceArchived(SCOPE, ANA, first.resource.id, true);
    await h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Chair 2', kind: 'place' });
    expect(await refusal(h.catalogue.setResourceArchived(SCOPE, ANA, first.resource.id, false))).toBe('limit_reached');
  });

  it('does not count another workspace’s resources', async () => {
    const h = harness({ limits: capOf(1) });
    await h.catalogue.saveResource(OTHER_WORKSPACE, ANA, null, { name: 'Their chair', kind: 'place' });
    const mine = await h.catalogue.saveResource(SCOPE, ANA, null, { name: 'My chair', kind: 'place' });
    expect(mine.resource.name).toBe('My chair');
  });

  it('links a member who works the desk, and nobody else', async () => {
    const h = harness({ desk: [ANA] });
    const linked = await h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Ana', kind: 'staff', userId: ANA });
    expect(linked.resource.userId).toBe(ANA);
    expect(await refusal(h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Ben', kind: 'staff', userId: BEN }))).toBe(
      'invalid_member',
    );
  });

  it('⚠ links nobody when the directory is unbound — fail closed', async () => {
    const h = harness();
    expect(await refusal(h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Ana', kind: 'staff', userId: ANA }))).toBe(
      'invalid_member',
    );
    // With no account named, a person can still be booked.
    const unlinked = await h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Ana', kind: 'staff' });
    expect(unlinked.resource.userId).toBeNull();
  });

  it('replaces a resource’s whole week', async () => {
    const h = harness();
    const ids = await shop(h);
    const changed = await h.catalogue.setResourceHours(SCOPE, ANA, ids.resourceId, [
      { weekday: 1, startMinute: 600, endMinute: 900 },
    ]);
    expect(changed.hours.map((row) => [row.weekday, row.startMinute, row.endMinute])).toEqual([[1, 600, 900]]);
    expect(h.prisma.state.bookingHours).toHaveLength(1);
  });

  it('⚠ refused hours leave the old week in place', async () => {
    const h = harness();
    const ids = await shop(h);
    const overlapping = [
      { weekday: 1, startMinute: 540, endMinute: 780 },
      { weekday: 1, startMinute: 720, endMinute: 1020 },
    ];
    expect(await refusal(h.catalogue.setResourceHours(SCOPE, ANA, ids.resourceId, overlapping))).toBe('invalid_hours');
    expect(h.prisma.state.bookingHours).toHaveLength(NINE_TO_FIVE.length);
  });

  it('answers not found for the hours of a resource elsewhere', async () => {
    const h = harness();
    const ids = await shop(h);
    expect(await refusal(h.catalogue.setResourceHours(OTHER_WORKSPACE, ANA, ids.resourceId, []))).toBe('not_found');
    expect(h.prisma.state.bookingHours).toHaveLength(NINE_TO_FIVE.length);
  });
});

describe('closed days', () => {
  it('closes a day and reopens it', async () => {
    const h = harness();
    const ids = await shop(h);
    const closed = await h.catalogue.addException(SCOPE, ANA, { day: DAY, note: 'Holiday' });
    expect(await refusal(book(h, ids, '10:00'))).toBe('outside_hours');
    await h.catalogue.removeException(SCOPE, ANA, closed.id);
    expect((await book(h, ids, '10:00')).status).toBe('confirmed');
  });

  it('⚠ closing a day does not cancel what is already booked on it', async () => {
    const h = harness();
    const ids = await shop(h);
    const made = await book(h, ids, '10:00');
    await h.catalogue.addException(SCOPE, ANA, { day: DAY, note: 'Holiday' });
    expect((await h.reads.appointment(SCOPE, made.id))?.appointment.status).toBe('confirmed');
  });

  it('cannot close a resource of another workspace, or remove a closure from one', async () => {
    const h = harness();
    const ids = await shop(h);
    expect(
      await refusal(h.catalogue.addException(OTHER_WORKSPACE, ANA, { day: DAY, resourceId: ids.resourceId })),
    ).toBe('not_found');
    const closed = await h.catalogue.addException(SCOPE, ANA, { day: DAY });
    expect(await refusal(h.catalogue.removeException(OTHER_WORKSPACE, ANA, closed.id))).toBe('not_found');
  });
});

describe('settings', () => {
  it('saves, and tells the workspace its settings changed', async () => {
    const h = harness();
    await h.catalogue.saveSettings(SCOPE, ANA, { slotMinutes: 15, reminderMinutes: 30 });
    expect(h.pubsub.sent.at(-1)).toEqual({ ...SCOPE, change: 'settings', appointmentId: null, actorId: ANA });
  });

  it('refuses a slot size that is not on offer', async () => {
    expect(await refusal(harness().catalogue.saveSettings(SCOPE, ANA, { slotMinutes: 7, reminderMinutes: 15 }))).toBe(
      'invalid_settings',
    );
  });
});
