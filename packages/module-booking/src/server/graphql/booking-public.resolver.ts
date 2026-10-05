import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA } from '@kwtech/module-kit';
import { SetMetadata } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BookingPublicService, type BookingPublicSlots, type BookingPublicView } from '../booking-public.service.js';
import {
  BookingPublicBookingType,
  BookingPublicPageType,
  BookingPublicRequestInputType,
  BookingPublicRequestType,
  BookingPublicSlotsType,
} from './booking.types.js';

const NO_SESSION = 'A customer booking on the public page has no account and no session';
const TOKEN_IS_AUTHORITY = 'A customer has no session; the manage token in their link is the authorisation';
const GUESSING = 'Somebody presenting a manage token may be guessing a secret';

/**
 * Booking's PUBLIC surface (BOOKING-PLAN §6): the page a customer books on, and
 * the manage link they are given.
 *
 * ## Why this is its own resolver
 *
 * `BookingResolver` declares workspace scope on its class, and every operation
 * there needs a signed-in member with a key. These are reached by somebody with
 * no account. Keeping them in a separate class means no public marker can ever
 * sit on the workspace class, and no workspace scope on this one —
 * `surface-coverage.test.ts` checks both. Every method here must be public,
 * which is also what makes a method added without a marker fail loudly:
 * `JwtAuthGuard` refuses it "Not signed in".
 *
 * ## Two kinds of operation
 *
 *   BY LINK ID — the page, its free times, asking for a booking. The link is
 *     handed out, so these are public and NOT credential surfaces: there is no
 *     secret in them to guess. They take no organization or workspace: the
 *     link names the shop, so a visitor cannot ask about somebody else's.
 *   BY MANAGE TOKEN — seeing, cancelling and moving one booking. ⚠ CREDENTIAL
 *     SURFACES: the token is a secret, so the app points its tightest rate
 *     limit at every one of them. This module may not depend on the throttler,
 *     so it declares the fact and the app applies the policy.
 *
 * ⚠ ONE REFUSAL. A link that is not there, a page turned off and a token nobody
 * was given all answer `null` — see `BookingPublicService`.
 */
@Resolver()
export class BookingPublicResolver {
  constructor(private readonly publicBooking: BookingPublicService) {}

  // ── by link id ────────────────────────────────────────────────────────────

  @SetMetadata(PUBLIC_SURFACE_METADATA, NO_SESSION)
  @Query(() => BookingPublicPageType, { name: 'publicBookingPage', nullable: true })
  async publicBookingPage(@Args('linkId') linkId: string): Promise<BookingPublicPageType | null> {
    const page = await this.publicBooking.page(linkId);
    if (!page) return null;
    return {
      ...page,
      services: page.services.map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        price: service.price,
      })),
    };
  }

  @SetMetadata(PUBLIC_SURFACE_METADATA, NO_SESSION)
  @Query(() => [BookingPublicSlotsType], { name: 'publicBookingSlots', nullable: true })
  async publicBookingSlots(
    @Args('linkId') linkId: string,
    @Args('serviceId') serviceId: string,
    @Args('day') day: string,
  ): Promise<BookingPublicSlotsType[] | null> {
    const slots = await this.publicBooking.slots(linkId, serviceId, day);
    return slots ? slots.map(renderSlots) : null;
  }

  /**
   * A customer asks for a booking. The answer carries the manage token, ⚠ THIS
   * ONCE: it is stored only as its hash.
   *
   * Not a credential surface — nothing here is guessed. What stops one visitor
   * holding a shop's whole week is in the service: a contact is required, and
   * the number of requests waiting is capped per contact and per workspace.
   */
  @SetMetadata(PUBLIC_SURFACE_METADATA, NO_SESSION)
  @Mutation(() => BookingPublicRequestType, { name: 'requestPublicBooking' })
  async requestPublicBooking(
    @Args('linkId') linkId: string,
    @Args('input', { type: () => BookingPublicRequestInputType }) input: BookingPublicRequestInputType,
  ): Promise<BookingPublicRequestType> {
    const { token, view } = await this.publicBooking.request(linkId, { ...input });
    return { manageToken: token, booking: renderBooking(view) };
  }

  // ── by manage token ───────────────────────────────────────────────────────

  /** ⚠ NULL IS THE ONLY REFUSAL: a token nobody was given, whatever its shape. */
  @SetMetadata(PUBLIC_SURFACE_METADATA, TOKEN_IS_AUTHORITY)
  @SetMetadata(CREDENTIAL_SURFACE_METADATA, GUESSING)
  @Query(() => BookingPublicBookingType, { name: 'publicBooking', nullable: true })
  async publicBookingByToken(@Args('token') token: string): Promise<BookingPublicBookingType | null> {
    const view = await this.publicBooking.view(token);
    return view ? renderBooking(view) : null;
  }

  @SetMetadata(PUBLIC_SURFACE_METADATA, TOKEN_IS_AUTHORITY)
  @SetMetadata(CREDENTIAL_SURFACE_METADATA, GUESSING)
  @Query(() => [BookingPublicSlotsType], { name: 'publicBookingMoveSlots', nullable: true })
  async publicBookingMoveSlots(
    @Args('token') token: string,
    @Args('day') day: string,
  ): Promise<BookingPublicSlotsType[] | null> {
    const slots = await this.publicBooking.moveSlots(token, day);
    return slots ? slots.map(renderSlots) : null;
  }

  @SetMetadata(PUBLIC_SURFACE_METADATA, TOKEN_IS_AUTHORITY)
  @SetMetadata(CREDENTIAL_SURFACE_METADATA, GUESSING)
  @Mutation(() => BookingPublicBookingType, { name: 'cancelPublicBooking' })
  async cancelPublicBooking(
    @Args('token') token: string,
    @Args('reason', { type: () => String, nullable: true }) reason?: string | null,
  ): Promise<BookingPublicBookingType> {
    return renderBooking(await this.publicBooking.cancel(token, reason));
  }

  /** The booking goes back to waiting for staff at the new time (D8). */
  @SetMetadata(PUBLIC_SURFACE_METADATA, TOKEN_IS_AUTHORITY)
  @SetMetadata(CREDENTIAL_SURFACE_METADATA, GUESSING)
  @Mutation(() => BookingPublicBookingType, { name: 'reschedulePublicBooking' })
  async reschedulePublicBooking(
    @Args('token') token: string,
    @Args('startsAt') startsAt: string,
    @Args('resourceId') resourceId: string,
  ): Promise<BookingPublicBookingType> {
    return renderBooking(await this.publicBooking.reschedule(token, startsAt, resourceId));
  }
}

function renderSlots(entry: BookingPublicSlots): BookingPublicSlotsType {
  return {
    resourceId: entry.resourceId,
    resourceName: entry.resourceName,
    starts: entry.starts.map((start) => start.toISOString()),
  };
}

/**
 * ⚠ FIELD BY FIELD, never a spread of the row: the row carries the workspace's
 * ids, the token's hash and who made and decided the booking, and none of that
 * is the customer's to read.
 */
function renderBooking(view: BookingPublicView): BookingPublicBookingType {
  const { appointment, page } = view;
  return {
    title: page.title,
    note: page.note,
    timeZone: page.timeZone,
    today: page.today,
    lastDay: page.lastDay,
    cutoffMinutes: page.cutoffMinutes,
    serviceId: appointment.serviceId,
    serviceName: view.serviceName,
    resourceId: appointment.resourceId,
    resourceName: view.resourceName,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    status: appointment.status,
    customerName: appointment.customerName,
    reason: view.reason,
    canChange: view.canChange,
  };
}
