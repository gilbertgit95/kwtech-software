import type { ProcessRunContext } from '@kwtech/module-kit';
import {
  checkCustomerChange,
  checkPublicStart,
  earliestPublicStart,
  lastPublicDay,
  requestLapsesAt,
} from '../src/domain/public.js';
import { addBookingDays, workspaceBookingDay } from '../src/domain/time.js';
import { hashManageToken, newManageToken, newPublicLinkId } from '../src/server/booking-secrets.js';
import { ANA, BEN, book, harness, manila, OTHER_WORKSPACE, openPublicPage, SCOPE, shop } from './harness.js';

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { reason?: string }).reason ?? `threw without a reason: ${(error as Error).message}`;
  }
  return 'was not refused';
}

/**
 * A day a CUSTOMER may book: thirty days from the real today, in Manila. The
 * suite's usual far-off day is past any horizon a workspace may set, and the
 * customer's rules are measured from the real clock.
 */
const D = addBookingDays(workspaceBookingDay(new Date(), 'Asia/Manila'), 30);

const MARIA = { customerName: 'Maria Santos', customerPhone: '0917 555 0100' };

/** A shop with its public page on, and what a visitor needs to ask for a booking. */
async function openShop(rules: Parameters<typeof openPublicPage>[1] = {}, options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options);
  const ids = await shop(h);
  const linkId = await openPublicPage(h, rules);
  const ask = (time: string, who: object = MARIA, day: string = D) =>
    h.publicBooking.request(linkId, { ...ids, startsAt: manila(time, day), ...MARIA, ...who });
  return { h, ids, linkId, ask };
}

describe('the customer’s rules', () => {
  const rules = { leadMinutes: 60, horizonDays: 30, cutoffMinutes: 120 };
  const now = new Date('2026-10-05T01:00:00Z');
  const clock = { now, today: '2026-10-05' };

  it('asks for notice: nothing sooner than the lead', () => {
    expect(earliestPublicStart(now, rules).toISOString()).toBe('2026-10-05T02:00:00.000Z');
    const at = (iso: string) => ({ startsAt: new Date(iso), startDay: '2026-10-05' });
    expect(checkPublicStart(at('2026-10-05T01:59:00Z'), clock, rules)).toBe('too_soon');
    expect(checkPublicStart(at('2026-10-05T02:00:00Z'), clock, rules)).toBeNull();
  });

  it('stops at the horizon, counted in the workspace’s days', () => {
    expect(lastPublicDay('2026-10-05', rules)).toBe('2026-11-04');
    const on = (day: string) => ({ startsAt: new Date(`${day}T02:00:00Z`), startDay: day });
    expect(checkPublicStart(on('2026-11-04'), clock, rules)).toBeNull();
    expect(checkPublicStart(on('2026-11-05'), clock, rules)).toBe('too_far_ahead');
  });

  it('lets the customer change a booking until the cutoff, and only one that has not begun', () => {
    const startsAt = new Date('2026-10-05T06:00:00Z');
    const at = (iso: string) => new Date(iso);
    expect(checkCustomerChange({ status: 'confirmed', startsAt }, at('2026-10-05T04:00:00Z'), rules)).toBeNull();
    expect(checkCustomerChange({ status: 'pending', startsAt }, at('2026-10-05T04:01:00Z'), rules)).toBe('past_cutoff');
    expect(checkCustomerChange({ status: 'arrived', startsAt }, now, rules)).toBe('wrong_status');
    expect(checkCustomerChange({ status: 'cancelled', startsAt }, now, rules)).toBe('wrong_status');
  });

  it('lapses a request after its wait, or at its own time — whichever is first', () => {
    const pendingSince = new Date('2026-10-05T00:00:00Z');
    const far = { pendingSince, startsAt: new Date('2026-10-09T00:00:00Z') };
    const near = { pendingSince, startsAt: new Date('2026-10-05T06:00:00Z') };
    expect(requestLapsesAt(far, 24).toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(requestLapsesAt(near, 24).toISOString()).toBe('2026-10-05T06:00:00.000Z');
  });
});

describe('the link and the token', () => {
  it('makes a link that cannot be worked out, and a token nobody guesses', () => {
    expect(newPublicLinkId()).toMatch(/^[A-Za-z0-9_-]{12}$/u);
    expect(newPublicLinkId()).not.toBe(newPublicLinkId());
    const { token, hash } = newManageToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(hash).toBe(hashManageToken(token));
    expect(hash).not.toContain(token);
  });
});

describe('the public page', () => {
  it('⚠ is off until a workspace turns it on, and has no link before then', async () => {
    const h = harness();
    await shop(h);
    expect((await h.reads.settingsRead(SCOPE)).publicLinkId).toBeNull();
    expect(h.prisma.state.bookingSettings).toEqual([]);
  });

  it('cannot be turned on without a name for customers to know it by', async () => {
    const h = harness();
    expect(await refusal(h.catalogue.saveSettings(SCOPE, ANA, { publicEnabled: true }))).toBe('invalid_title');
  });

  it('shows what the shop wrote, what can be booked, and nothing that says which workspace it is', async () => {
    const { h, ids, linkId } = await openShop();
    await h.catalogue.saveService(SCOPE, ANA, null, { name: 'Nobody does this', durationMinutes: 30, resourceIds: [] });
    const page = await h.publicResolver.publicBookingPage(linkId);
    expect(page).toMatchObject({ title: 'Ana’s Shop', note: '2nd floor, beside the bakery.', timeZone: 'Asia/Manila' });
    // A service nobody performs is not offered: it would show no time at all.
    expect(page?.services.map((service) => [service.id, service.name])).toEqual([[ids.serviceId, 'Consultation']]);
    expect(JSON.stringify(page)).not.toMatch(/org-1|ws-1/u);
  });

  it('⚠ answers null for a link that does not exist and for a page that is turned off — the same answer', async () => {
    const { h, linkId } = await openShop();
    expect(await h.publicBooking.page('no-such-link')).toBeNull();
    expect(await h.publicBooking.slots('no-such-link', 'x', D)).toBeNull();
    await h.catalogue.saveSettings(SCOPE, ANA, { publicEnabled: false });
    expect(await h.publicBooking.page(linkId)).toBeNull();
  });

  it('keeps its link when turned off and on again, and retires it on a reset', async () => {
    const { h, linkId } = await openShop();
    await h.catalogue.saveSettings(SCOPE, ANA, { publicEnabled: false });
    const again = await h.catalogue.saveSettings(SCOPE, ANA, { publicEnabled: true });
    expect(again.publicLinkId).toBe(linkId);

    const reset = await h.catalogue.resetPublicLink(SCOPE, BEN);
    expect(reset.publicLinkId).not.toBe(linkId);
    expect(await h.publicBooking.page(linkId)).toBeNull();
    expect(await h.publicBooking.page(reset.publicLinkId ?? '')).not.toBeNull();
  });

  it('⚠ a settings save that names only one thing leaves the public page as it was', async () => {
    const { h, linkId } = await openShop({ leadMinutes: 45 });
    const saved = await h.catalogue.saveSettings(SCOPE, ANA, { slotMinutes: 15, reminderMinutes: null });
    expect(saved.settings).toMatchObject({
      slotMinutes: 15,
      reminderMinutes: 15,
      publicEnabled: true,
      leadMinutes: 45,
    });
    expect(saved.publicLinkId).toBe(linkId);
  });

  it('offers free times with the resource’s name, and nothing about who holds the rest', async () => {
    const { h, ids, linkId } = await openShop();
    await book(h, ids, '10:00', D);
    const slots = await h.publicResolver.publicBookingSlots(linkId, ids.serviceId, D);
    expect(slots?.map((entry) => entry.resourceName)).toEqual(['Chair 1']);
    expect(slots?.[0]?.starts).toContain(manila('11:00', D));
    expect(slots?.[0]?.starts).not.toContain(manila('10:00', D));
    expect(JSON.stringify(slots)).not.toContain('Maria');
  });

  it('offers nothing past the horizon, before today, or for a service that is not this shop’s', async () => {
    const { h, ids, linkId } = await openShop({ horizonDays: 7 });
    expect(await h.publicBooking.slots(linkId, ids.serviceId, D)).toEqual([]);
    expect(await h.publicBooking.slots(linkId, ids.serviceId, '2020-01-01')).toEqual([]);
    expect(await h.publicBooking.slots(linkId, 'somebody-elses-service', D)).toEqual([]);
  });
});

describe('asking for a booking', () => {
  it('⚠ is a REQUEST: pending, holding its slot, made by nobody on staff (D2)', async () => {
    const { h, ids, ask } = await openShop();
    const { view } = await ask('10:00');
    expect(view.appointment).toMatchObject({ status: 'pending', createdById: null, customerName: 'Maria Santos' });
    expect(view.appointment.pendingSince).toBeInstanceOf(Date);
    // It holds the time against the desk and against the next visitor alike.
    expect(await refusal(book(h, ids, '10:30', D))).toBe('slot_taken');
    expect(await refusal(ask('10:30', { customerPhone: '0918 000 0000' }))).toBe('slot_taken');
    const changes = (await h.reads.appointment(SCOPE, view.appointment.id))?.changes;
    expect(changes?.map((change) => [change.kind, change.actorKind, change.actorId])).toEqual([
      ['created', 'customer', null],
    ]);
  });

  it('⚠ hands over the manage token once, and stores only its hash', async () => {
    const { h, ask } = await openShop();
    const { token, view } = await ask('10:00');
    const stored = h.prisma.state.bookingAppointment.find((row) => row.id === view.appointment.id);
    expect(stored?.manageTokenHash).toBe(hashManageToken(token));
    expect(JSON.stringify(h.prisma.state)).not.toContain(token);
  });

  it('gives a booking made by staff no manage link', async () => {
    const { h, ids } = await openShop();
    expect((await book(h, ids, '10:00', D)).manageTokenHash).toBeNull();
  });

  it('⚠ sends the customer nothing of the workspace, the hash, or who decided', async () => {
    const { h, ids, linkId } = await openShop();
    const answer = await h.publicResolver.requestPublicBooking(linkId, {
      ...ids,
      startsAt: manila('10:00', D),
      ...MARIA,
    });
    expect(answer.booking).toMatchObject({ status: 'pending', serviceName: 'Consultation', resourceName: 'Chair 1' });
    const sent = JSON.stringify(answer.booking);
    expect(sent).not.toMatch(/org-1|ws-1|manageTokenHash|decidedBy|createdBy/u);
    expect(Object.keys(answer.booking)).not.toContain('id');
  });

  it('requires a way to reach the customer', async () => {
    const { ask } = await openShop();
    expect(await refusal(ask('10:00', { customerPhone: null, customerEmail: '' }))).toBe('contact_required');
    expect(
      (await ask('10:00', { customerPhone: null, customerEmail: 'maria@example.com' })).view.appointment.status,
    ).toBe('pending');
  });

  it('⚠ lets one contact have only a few requests waiting, however they type their number', async () => {
    const { ask } = await openShop();
    await ask('09:00');
    await ask('10:00', { customerPhone: ' 0917  555 0100 ' });
    await ask('11:00');
    expect(await refusal(ask('12:00'))).toBe('too_many_requests');
    // Somebody else is not held back by Maria's requests.
    expect((await ask('12:00', { customerPhone: '0918 000 0000' })).view.appointment.status).toBe('pending');
  });

  it('obeys the notice and the horizon — which do not bind staff', async () => {
    const { h, ids, ask } = await openShop({ horizonDays: 7 });
    expect(await refusal(ask('10:00'))).toBe('too_far_ahead');
    expect((await book(h, ids, '10:00', D)).status).toBe('confirmed');
  });

  it('⚠ tells a visitor only that a time is not free, never why the shop cannot take it', async () => {
    const { h, ids, ask, linkId } = await openShop();
    // Outside the hours, a resource that does not perform it, a service of another shop: all one answer.
    expect(await refusal(ask('08:00'))).toBe('slot_taken');
    const other = await h.catalogue.saveResource(SCOPE, ANA, null, { name: 'Printer', kind: 'equipment' });
    const elsewhere = h.publicBooking.request(linkId, {
      ...ids,
      resourceId: other.resource.id,
      startsAt: manila('10:00', D),
      ...MARIA,
    });
    expect(await refusal(elsewhere)).toBe('slot_taken');
    const foreign = h.publicBooking.request(linkId, {
      ...ids,
      serviceId: 'nope',
      startsAt: manila('10:00', D),
      ...MARIA,
    });
    expect(await refusal(foreign)).toBe('slot_taken');
  });

  it('refuses on a link that is not open', async () => {
    const { h, ids, linkId, ask } = await openShop();
    await h.catalogue.saveSettings(SCOPE, ANA, { publicEnabled: false });
    expect(await refusal(ask('10:00'))).toBe('public_closed');
    const wrong = h.publicBooking.request(`${linkId}x`, { ...ids, startsAt: manila('10:00', D), ...MARIA });
    expect(await refusal(wrong)).toBe('public_closed');
  });

  it('tells the desk a request is waiting, and survives the desk not being reachable', async () => {
    const { h, ask } = await openShop({}, { desk: [ANA, BEN], notify: true });
    const { view } = await ask('10:00');
    expect(h.deskNotices.map(({ what, notice }) => [what, notice.recipientIds, notice.appointmentId])).toEqual([
      ['requestWaiting', [ANA, BEN], view.appointment.id],
    ]);
    // With nobody to tell and nothing to tell them with, the request is still made.
    const quiet = await openShop();
    expect((await quiet.ask('10:00')).view.appointment.status).toBe('pending');
  });

  it('lists every waiting request for the desk, whatever day it is for, the longest-waiting first', async () => {
    const { h, ask } = await openShop();
    const later = await ask('10:00', MARIA, addBookingDays(D, 7));
    const sooner = await ask('10:00', { customerPhone: '0918 000 0000' });
    await book(h, await shop(h), '15:00', D);
    expect((await h.reads.requests(SCOPE)).map((row) => row.id)).toEqual([
      later.view.appointment.id,
      sooner.view.appointment.id,
    ]);
    expect(await h.reads.requests(OTHER_WORKSPACE)).toEqual([]);
  });
});

describe('the manage link', () => {
  it('shows the customer where their booking stands', async () => {
    const { h, ask } = await openShop();
    const { token, view } = await ask('10:00');
    expect((await h.publicBooking.view(token))?.appointment.status).toBe('pending');
    await h.writes.confirm(SCOPE, ANA, view.appointment.id);
    const confirmed = await h.publicResolver.publicBookingByToken(token);
    expect([confirmed?.status, confirmed?.canChange, confirmed?.title]).toEqual(['confirmed', true, 'Ana’s Shop']);
  });

  it('⚠ answers null for a token nobody was given, whatever its shape', async () => {
    const { h, ask } = await openShop();
    const { token } = await ask('10:00');
    for (const wrong of [`${token}x`, token.slice(0, -1), '', 'a'.repeat(5000)]) {
      expect(await h.publicBooking.view(wrong)).toBeNull();
      expect(await h.publicBooking.moveSlots(wrong, D)).toBeNull();
    }
    expect(await refusal(h.publicBooking.cancel('nope', null))).toBe('not_found');
    expect(await refusal(h.publicBooking.reschedule('nope', manila('11:00', D), 'x'))).toBe('not_found');
  });

  it('still works after the public page is turned off: the booking exists', async () => {
    const { h, ask } = await openShop();
    const { token } = await ask('10:00');
    await h.catalogue.saveSettings(SCOPE, ANA, { publicEnabled: false });
    expect((await h.publicBooking.view(token))?.appointment.status).toBe('pending');
    expect((await h.publicBooking.cancel(token, null)).appointment.status).toBe('cancelled');
  });

  it('lets the customer cancel, keeps the booking, and frees the time', async () => {
    const { h, ids, ask } = await openShop({}, { desk: [ANA], notify: true });
    const { token, view } = await ask('10:00');
    const cancelled = await h.publicBooking.cancel(token, 'Change of plans');
    expect([cancelled.appointment.status, cancelled.reason, cancelled.canChange]).toEqual([
      'cancelled',
      'Change of plans',
      false,
    ]);
    const last = (await h.reads.appointment(SCOPE, view.appointment.id))?.changes.at(-1);
    expect([last?.kind, last?.actorKind, last?.actorId]).toEqual(['cancelled', 'customer', null]);
    expect((await book(h, ids, '10:00', D)).status).toBe('confirmed');
    expect(h.deskNotices.map(({ what }) => what)).toEqual(['requestWaiting', 'customerCancelled']);
  });

  it('⚠ a customer’s move goes back to WAITING, at the new time, giving up the old one (D8)', async () => {
    const { h, ids, ask } = await openShop({}, { desk: [ANA], notify: true });
    const { token, view } = await ask('10:00');
    await h.writes.confirm(SCOPE, ANA, view.appointment.id);

    const moved = await h.publicBooking.reschedule(token, manila('14:00', D), ids.resourceId);
    expect(moved.appointment).toMatchObject({ id: view.appointment.id, status: 'pending', decidedById: null });
    expect(moved.appointment.startsAt.toISOString()).toBe(manila('14:00', D));
    // The old time is free at once; the new one is held while it waits.
    expect((await book(h, ids, '10:00', D)).status).toBe('confirmed');
    expect(await refusal(book(h, ids, '14:30', D))).toBe('slot_taken');
    const last = (await h.reads.appointment(SCOPE, view.appointment.id))?.changes.at(-1);
    expect([last?.kind, last?.actorKind, last?.fromStartsAt?.toISOString()]).toEqual([
      'rescheduled',
      'customer',
      manila('10:00', D),
    ]);
    expect(h.deskNotices.at(-1)?.what).toBe('customerRescheduled');
  });

  it('⚠ a move by STAFF leaves a confirmed booking confirmed (D6)', async () => {
    const { h, ids, ask } = await openShop();
    const { view } = await ask('10:00');
    await h.writes.confirm(SCOPE, ANA, view.appointment.id);
    const moved = await h.writes.reschedule(SCOPE, ANA, view.appointment.id, manila('14:00', D), ids.resourceId);
    expect(moved.status).toBe('confirmed');
  });

  it('offers the customer the times they may move to, their own time not blocking them', async () => {
    const { h, ask } = await openShop();
    const { token } = await ask('10:00');
    const [slots] = (await h.publicBooking.moveSlots(token, D)) ?? [];
    expect(slots?.starts.map((start) => start.toISOString())).toContain(manila('10:30', D));
  });

  it('refuses a move onto a taken time, leaving the booking where it was', async () => {
    const { h, ids, ask } = await openShop();
    const { token, view } = await ask('10:00');
    await book(h, ids, '14:00', D);
    expect(await refusal(h.publicBooking.reschedule(token, manila('14:30', D), ids.resourceId))).toBe('slot_taken');
    expect((await h.publicBooking.view(token))?.appointment.startsAt.toISOString()).toBe(manila('10:00', D));
    expect(view.appointment.status).toBe('pending');
  });

  it('⚠ past the cutoff the customer can change nothing — the desk still can', async () => {
    // A cutoff of a week, the longest allowed, and a booking whose start the fake's clock is already inside of.
    const { h, ids, ask } = await openShop({ cutoffMinutes: 7 * 1440 });
    const { token, view } = await ask('10:00');
    const row = h.prisma.state.bookingAppointment.find((candidate) => candidate.id === view.appointment.id);
    if (row) row.startsAt = new Date(Date.now() + 60 * 60_000);
    expect((await h.publicBooking.view(token))?.canChange).toBe(false);
    expect(await refusal(h.publicBooking.cancel(token, null))).toBe('past_cutoff');
    expect(await refusal(h.publicBooking.reschedule(token, manila('14:00', D), ids.resourceId))).toBe('past_cutoff');
    expect((await h.writes.cancel(SCOPE, ANA, view.appointment.id, 'Customer phoned')).status).toBe('cancelled');
  });

  it('says why a declined request was declined, when staff said', async () => {
    const { h, ask } = await openShop();
    const { token, view } = await ask('10:00');
    await h.writes.decline(SCOPE, ANA, view.appointment.id, 'Fully booked that morning');
    const seen = await h.publicBooking.view(token);
    expect([seen?.appointment.status, seen?.reason, seen?.canChange]).toEqual([
      'declined',
      'Fully booked that morning',
      false,
    ]);
  });
});

describe('booking.lapse_requests', () => {
  const HERE = { ...SCOPE, timeZone: 'Asia/Manila' };
  function contextAt(
    now: Date,
    options: { maxItems?: number; signal?: AbortSignal; workspaces?: (typeof HERE)[] } = {},
  ) {
    const context: ProcessRunContext = {
      now,
      schedule: { kind: 'interval', everyMinutes: 5 },
      maxItems: options.maxItems ?? 500,
      tooLateAfterMinutes: 1440,
      signal: options.signal ?? new AbortController().signal,
      async workspaces() {
        return { workspaces: options.workspaces ?? [HERE], nextCursor: null };
      },
    };
    return context;
  }
  const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000);

  it('⚠ declines a request nobody answered in time, by the app, and frees its slot', async () => {
    const { h, ids, ask } = await openShop({ lapseHours: 24 });
    const { token, view } = await ask('10:00');
    expect(await h.lapses.run(contextAt(hoursFromNow(23)))).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
    expect(await h.lapses.run(contextAt(hoursFromNow(25)))).toEqual({ handled: 1, skippedLate: 0, leftForNext: 0 });

    const after = await h.reads.appointment(SCOPE, view.appointment.id);
    expect([after?.appointment.status, after?.appointment.pendingSince]).toEqual(['declined', null]);
    const last = after?.changes.at(-1);
    expect([last?.kind, last?.actorKind, last?.actorId, last?.reason]).toEqual([
      'declined',
      'system',
      null,
      'Not confirmed in time',
    ]);
    expect((await h.publicBooking.view(token))?.reason).toBe('Not confirmed in time');
    expect((await book(h, ids, '10:00', D)).status).toBe('confirmed');
  });

  it('⚠ run twice, the second run does nothing', async () => {
    const { h, ask } = await openShop();
    await ask('10:00');
    await h.lapses.run(contextAt(hoursFromNow(25)));
    expect(await h.lapses.run(contextAt(hoursFromNow(26)))).toEqual({ handled: 0, skippedLate: 0, leftForNext: 0 });
    expect(h.prisma.state.bookingChange.filter((change) => change.kind === 'declined')).toHaveLength(1);
  });

  it('lapses a request when its own time arrives, however recently it was asked', async () => {
    const { h, ask } = await openShop({ lapseHours: 168 });
    const { view } = await ask('10:00');
    const at = new Date(new Date(manila('10:00', D)).getTime() - 7 * 86_400_000);
    // A week before its time, with a week's wait allowed: still waiting…
    const row = h.prisma.state.bookingAppointment.find((candidate) => candidate.id === view.appointment.id);
    if (row) row.pendingSince = at;
    expect((await h.lapses.run(contextAt(new Date(at.getTime() + 3_600_000)))).handled).toBe(0);
    // …and at its time, gone.
    expect((await h.lapses.run(contextAt(new Date(manila('10:00', D))))).handled).toBe(1);
  });

  it('leaves alone what staff confirmed, and what staff booked', async () => {
    const { h, ids, ask } = await openShop();
    const { view } = await ask('10:00');
    await h.writes.confirm(SCOPE, ANA, view.appointment.id);
    await book(h, ids, '14:00', D);
    expect((await h.lapses.run(contextAt(hoursFromNow(1000)))).handled).toBe(0);
  });

  it('⚠ a customer’s move starts the wait again', async () => {
    const { h, ids, ask } = await openShop({ lapseHours: 24 });
    const { token, view } = await ask('10:00');
    const row = h.prisma.state.bookingAppointment.find((candidate) => candidate.id === view.appointment.id);
    if (row) row.pendingSince = hoursFromNow(-23);
    await h.publicBooking.reschedule(token, manila('14:00', D), ids.resourceId);
    expect((await h.lapses.run(contextAt(hoursFromNow(2)))).handled).toBe(0);
  });

  it('⚠ stops at its item limit, and the next run finishes', async () => {
    const { h, ask } = await openShop();
    await ask('09:00');
    await ask('10:00', { customerPhone: '0918 000 0000' });
    await ask('11:00', { customerPhone: '0919 000 0000' });
    const late = hoursFromNow(25);
    expect(await h.lapses.run(contextAt(late, { maxItems: 2 }))).toEqual({
      handled: 2,
      skippedLate: 0,
      leftForNext: 1,
    });
    expect(await h.lapses.run(contextAt(late, { maxItems: 2 }))).toEqual({
      handled: 1,
      skippedLate: 0,
      leftForNext: 0,
    });
  });

  it('⚠ reaches only the workspaces it is handed, and stops when told', async () => {
    const { h, ask } = await openShop();
    await ask('10:00');
    const elsewhere = [{ ...OTHER_WORKSPACE, timeZone: 'Asia/Manila' }];
    expect((await h.lapses.run(contextAt(hoursFromNow(25), { workspaces: elsewhere }))).handled).toBe(0);
    const stopped = new AbortController();
    stopped.abort();
    expect((await h.lapses.run(contextAt(hoursFromNow(25), { signal: stopped.signal }))).handled).toBe(0);
  });
});
