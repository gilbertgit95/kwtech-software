import { ANA, BEN, book, DAY, harness, manila, NINE_TO_FIVE, OTHER_WORKSPACE, SCOPE, shop } from './harness.js';

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { reason?: string }).reason ?? `threw without a reason: ${(error as Error).message}`;
  }
  return 'was not refused';
}

const times = (starts: readonly Date[]) =>
  starts.map((start) =>
    start.toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }),
  );

describe('the day', () => {
  it('lists a workspace day’s bookings in order, whatever their status', async () => {
    const h = harness();
    const ids = await shop(h);
    const late = await book(h, ids, '15:00');
    const early = await book(h, ids, '09:00');
    await h.writes.cancel(SCOPE, ANA, late.id, 'Customer called');
    const day = await h.reads.day(SCOPE, DAY);
    expect(day.appointments.map((row) => [row.id, row.status])).toEqual([
      [early.id, 'confirmed'],
      [late.id, 'cancelled'],
    ]);
    expect([day.day, day.timeZone, day.truncated]).toEqual([DAY, 'Asia/Manila', false]);
  });

  it('⚠ cuts the day in the WORKSPACE’s zone: an 11 PM booking is on that day', async () => {
    const h = harness();
    const ids = await shop(h);
    await h.catalogue.setResourceHours(
      SCOPE,
      ANA,
      ids.resourceId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })),
    );
    // 23:00 in Manila on the 3rd is 15:00 UTC on the 3rd; 00:30 on the 4th is 16:30 UTC on the 3rd.
    const elevenPm = await book(h, ids, '23:00');
    const afterMidnight = await book(h, ids, '00:30', '2031-03-04');
    expect(elevenPm.startsAt.toISOString().slice(0, 10)).toBe(afterMidnight.startsAt.toISOString().slice(0, 10));

    expect((await h.reads.day(SCOPE, DAY)).appointments.map((row) => row.id)).toEqual([elevenPm.id]);
    expect((await h.reads.day(SCOPE, '2031-03-04')).appointments.map((row) => row.id)).toEqual([afterMidnight.id]);
  });

  it('⚠ and in another zone the same two bookings are one day', async () => {
    const h = harness({ timeZone: 'UTC' });
    const ids = await shop(h);
    await h.catalogue.setResourceHours(
      SCOPE,
      ANA,
      ids.resourceId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })),
    );
    await book(h, ids, '23:00');
    await book(h, ids, '00:30', '2031-03-04');
    expect((await h.reads.day(SCOPE, DAY)).appointments).toHaveLength(2);
  });

  it('shows nothing from another workspace', async () => {
    const h = harness();
    await book(h, await shop(h), '10:00');
    expect((await h.reads.day(OTHER_WORKSPACE, DAY)).appointments).toEqual([]);
  });

  it('refuses a day that is not one', async () => {
    expect(await refusal(harness().reads.day(SCOPE, 'tomorrow'))).toBe('invalid_day');
  });

  it('names the service, the resource and who made the booking', async () => {
    const h = harness({ desk: [ANA] });
    const made = await book(h, await shop(h), '10:00');
    const names = await h.reads.namesFor(SCOPE, [made]);
    expect([names.services.get(made.serviceId), names.resources.get(made.resourceId), names.members.get(ANA)]).toEqual([
      'Consultation',
      'Chair 1',
      'ana',
    ]);
  });
});

describe('free times', () => {
  it('offers the hours, in the workspace’s slot size', async () => {
    const h = harness();
    const ids = await shop(h);
    const [slots] = await h.reads.slots(SCOPE, ids.serviceId, DAY);
    expect(slots?.resourceId).toBe(ids.resourceId);
    expect(times(slots?.starts ?? []).slice(0, 3)).toEqual(['09:00', '09:30', '10:00']);
    expect(times(slots?.starts ?? []).at(-1)).toBe('16:00');
  });

  it('⚠ offers nothing a booking already holds', async () => {
    const h = harness();
    const ids = await shop(h);
    await book(h, ids, '10:00');
    const [slots] = await h.reads.slots(SCOPE, ids.serviceId, DAY);
    const offered = times(slots?.starts ?? []);
    expect(offered).toContain('09:00');
    expect(offered).toContain('11:00');
    for (const taken of ['09:30', '10:00', '10:30']) expect(offered).not.toContain(taken);
  });

  it('⚠ every time it offers is one the write accepts', async () => {
    const h = harness();
    const ids = await shop(h, { bufferBeforeMinutes: 15, bufferAfterMinutes: 15 });
    await book(h, ids, '11:00');
    await h.catalogue.addException(SCOPE, ANA, { day: DAY, startMinute: 14 * 60, endMinute: 15 * 60 });
    const [slots] = await h.reads.slots(SCOPE, ids.serviceId, DAY);
    const [first] = slots?.starts ?? [];
    expect(first).toBeDefined();
    // Each offered start, booked on a shop of its own: none may be refused.
    for (const start of slots?.starts ?? []) {
      const fresh = harness();
      const freshIds = await shop(fresh, { bufferBeforeMinutes: 15, bufferAfterMinutes: 15 });
      await book(fresh, freshIds, '11:00');
      await fresh.catalogue.addException(SCOPE, ANA, { day: DAY, startMinute: 14 * 60, endMinute: 15 * 60 });
      const made = await fresh.writes.create(SCOPE, ANA, {
        ...freshIds,
        startsAt: start.toISOString(),
        customerName: 'Maria',
      });
      expect(made.status).toBe('confirmed');
    }
  });

  it('leaves the booking being moved out of what blocks it', async () => {
    const h = harness();
    const ids = await shop(h);
    const made = await book(h, ids, '10:00');
    const [blocked] = await h.reads.slots(SCOPE, ids.serviceId, DAY);
    const [moving] = await h.reads.slots(SCOPE, ids.serviceId, DAY, made.id);
    expect(times(blocked?.starts ?? [])).not.toContain('10:30');
    expect(times(moving?.starts ?? [])).toContain('10:30');
  });

  it('follows a change of slot size', async () => {
    const h = harness();
    const ids = await shop(h);
    await h.catalogue.saveSettings(SCOPE, ANA, { slotMinutes: 60, reminderMinutes: 15 });
    const [slots] = await h.reads.slots(SCOPE, ids.serviceId, DAY);
    expect(times(slots?.starts ?? []).slice(0, 2)).toEqual(['09:00', '10:00']);
  });

  it('offers nothing on a closed day, for an archived service, or with an archived resource', async () => {
    const h = harness();
    const ids = await shop(h);
    await h.catalogue.addException(SCOPE, ANA, { day: DAY });
    expect((await h.reads.slots(SCOPE, ids.serviceId, DAY))[0]?.starts).toEqual([]);

    await h.catalogue.setResourceArchived(SCOPE, ANA, ids.resourceId, true);
    expect(await h.reads.slots(SCOPE, ids.serviceId, '2031-03-04')).toEqual([]);
    await h.catalogue.setResourceArchived(SCOPE, ANA, ids.resourceId, false);
    await h.catalogue.setServiceArchived(SCOPE, ANA, ids.serviceId, true);
    expect(await h.reads.slots(SCOPE, ids.serviceId, '2031-03-04')).toEqual([]);
  });

  it('answers not found for a service of another workspace', async () => {
    const h = harness();
    const ids = await shop(h);
    expect(await refusal(h.reads.slots(OTHER_WORKSPACE, ids.serviceId, DAY))).toBe('not_found');
  });
});

describe('the catalogue', () => {
  it('reads services with their resources and resources with their hours', async () => {
    const h = harness();
    const ids = await shop(h);
    const catalogue = await h.reads.catalogue(SCOPE);
    expect(catalogue.services.map((read) => [read.service.name, read.resourceIds])).toEqual([
      ['Consultation', [ids.resourceId]],
    ]);
    expect(catalogue.resources.map((read) => [read.resource.name, read.hours.length])).toEqual([
      ['Chair 1', NINE_TO_FIVE.length],
    ]);
  });

  it('hides archived ones unless asked', async () => {
    const h = harness();
    const ids = await shop(h);
    await h.catalogue.setServiceArchived(SCOPE, BEN, ids.serviceId, true);
    expect((await h.reads.catalogue(SCOPE)).services).toEqual([]);
    expect((await h.reads.catalogue(SCOPE, true)).services).toHaveLength(1);
  });

  it('⚠ reads the settings of this workspace only, and the defaults when it has set none', async () => {
    const h = harness();
    await h.catalogue.saveSettings(SCOPE, ANA, { slotMinutes: 15, reminderMinutes: 0 });
    expect(await h.reads.settings(SCOPE)).toMatchObject({ slotMinutes: 15, reminderMinutes: 0 });
    expect(await h.reads.settings(OTHER_WORKSPACE)).toMatchObject({ slotMinutes: 30, reminderMinutes: 15 });
  });

  it('lists nobody to link when the directory is unbound', async () => {
    expect(await harness().reads.members(SCOPE)).toEqual([]);
    expect((await harness({ desk: [ANA] }).reads.members(SCOPE)).map((member) => member.userId)).toEqual([ANA]);
  });

  it('starts from a day when listing closed days', async () => {
    const h = harness();
    await h.catalogue.addException(SCOPE, ANA, { day: '2031-01-01', note: 'New year' });
    await h.catalogue.addException(SCOPE, ANA, { day: '2031-12-25', note: 'Christmas' });
    expect((await h.reads.exceptions(SCOPE, '2031-06-01')).map((row) => row.note)).toEqual(['Christmas']);
  });
});

it('manila() is the instant a client would send', () => {
  expect(manila('09:00')).toBe('2031-03-03T01:00:00.000Z');
});
