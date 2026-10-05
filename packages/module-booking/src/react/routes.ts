/**
 * The two addresses a CUSTOMER uses. Both are public: nobody signs in.
 *
 *   /book/:linkId      the shop's booking page. The link id is handed out.
 *   /my-booking/:token one booking, for whoever holds its manage token — ⚠ the
 *                      token is a secret, and this URL is the customer's key.
 */
export const BOOKING_PUBLIC_PATH = '/book/:linkId';
export const BOOKING_MANAGE_PATH = '/my-booking/:token';

export function bookingPublicHref(linkId: string): string {
  return `/book/${encodeURIComponent(linkId)}`;
}

export function bookingManageHref(token: string): string {
  return `/my-booking/${encodeURIComponent(token)}`;
}
