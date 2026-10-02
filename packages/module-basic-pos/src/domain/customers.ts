import type { PosRefusal } from '../types.js';
import { normalizePosLine, preparePosLine } from './text.js';

/**
 * How a recorded customer is reached (D5): a phone number, an e-mail address
 * and a Facebook link, each optional and each its own field. They were one
 * free-text "contact" until 2026-10-02; a store that talks to its customers
 * through its Facebook page's Messenger needs the link kept as a link, and a
 * phone number that is not also an e-mail address.
 *
 * An ORDER still carries one contact line (`customerContact`): a walk-in types
 * one, and a linked customer's is `posCustomerContactLine`.
 */

/**
 * How many customers one search returns. A picker, not a report — and here,
 * not in the server, because the Customers list says so when it was cut.
 */
export const POS_CUSTOMER_SEARCH_MAX = 50;

/** In code points. */
export const POS_PHONE_MAX = 40;
export const POS_EMAIL_MAX = 254;
export const POS_FACEBOOK_URL_MAX = 300;

/**
 * A phone number as stored, or null for none, or why it is refused. Kept as
 * typed ("0917 123 4567", "+63 917 123 4567 loc 2"): a store reads it, nothing
 * dials it. It must carry a digit, so a name or a link pasted into the wrong
 * box is caught.
 */
export function preparePosPhone(raw: string): { phone: string | null } | { refused: PosRefusal } {
  const phone = preparePosLine(raw, POS_PHONE_MAX, { allowEmpty: true });
  if (phone === null) return { refused: 'invalid_phone' };
  if (phone.length === 0) return { phone: null };
  return /\d/u.test(phone) ? { phone } : { refused: 'invalid_phone' };
}

/**
 * An e-mail address as stored, or null for none, or why it is refused. Only
 * the shape is checked — something, `@`, a domain with a dot, no spaces: the
 * one test of an address is sending to it, and nothing here sends.
 */
export function preparePosEmail(raw: string): { email: string | null } | { refused: PosRefusal } {
  const email = preparePosLine(raw, POS_EMAIL_MAX, { allowEmpty: true });
  if (email === null) return { refused: 'invalid_email' };
  if (email.length === 0) return { email: null };
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? { email } : { refused: 'invalid_email' };
}

/** Where a customer's Facebook link may point: their profile or page, or their Messenger thread. */
const FACEBOOK_HOSTS = new Set(['facebook.com', 'fb.com', 'fb.me', 'm.me', 'messenger.com']);

/** The prefixes Facebook serves the same pages under: "www.", the mobile "m." and the others. */
const FACEBOOK_HOST_PREFIX = /^(www|m|web|mbasic|business)\./u;

/**
 * A customer's Facebook link as stored, or null for none, or why it is
 * refused. "facebook.com/juan", "m.me/juan" and a pasted
 * "https://www.facebook.com/profile.php?id=1" all become an `https://` link.
 *
 * ⚠ ONLY FACEBOOK'S OWN ADDRESSES, AND ONLY `https`. The Customers screen
 * draws this as a link staff click: a free-text URL would let anybody who can
 * save a customer plant `javascript:` or a look-alike site behind "Open in
 * Facebook". The server runs this too, so the screen never trusts its own check.
 */
export function preparePosFacebookUrl(raw: string): { facebookUrl: string | null } | { refused: PosRefusal } {
  const line = normalizePosLine(raw);
  if (line.length === 0) return { facebookUrl: null };
  if ([...line].length > POS_FACEBOOK_URL_MAX || /\s/u.test(line)) return { refused: 'invalid_facebook' };
  const url = parseUrl(/^[a-z][a-z\d+.-]*:/iu.test(line) ? line : `https://${line}`);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return { refused: 'invalid_facebook' };
  if (url.username || url.password || url.port) return { refused: 'invalid_facebook' };
  const host = url.hostname.toLowerCase();
  // The host as it is first: "m.me" is Messenger's own, not "me" under a mobile prefix.
  const known = FACEBOOK_HOSTS.has(host) || FACEBOOK_HOSTS.has(host.replace(FACEBOOK_HOST_PREFIX, ''));
  if (!known) return { refused: 'invalid_facebook' };
  // "facebook.com" alone is Facebook, not a person.
  if (url.pathname === '/' && url.search === '') return { refused: 'invalid_facebook' };
  return { facebookUrl: `https://${host}${url.pathname}${url.search}` };
}

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    // Not a URL at all: the caller refuses it with the Facebook message.
    return null;
  }
}

/**
 * The one contact line an order copies from the customer it is linked to
 * (D5): the phone, else the e-mail, else the Facebook link, else none. The
 * order of what a counter reaches for first — and any one of them is enough
 * to release an order unpaid or to owe change (D13, D14).
 */
export function posCustomerContactLine(customer: {
  phone: string | null;
  email: string | null;
  facebookUrl: string | null;
}): string | null {
  return customer.phone ?? customer.email ?? customer.facebookUrl;
}

/**
 * The till's one "Contact" line, as the fields of a customer being saved from
 * it ("Save as customer"): an `@` makes it the e-mail, anything else the
 * phone. A Facebook link is added on the Customers screen, where it has a box.
 */
export function posContactAsCustomerFields(contact: string): { phone: string | null; email: string | null } {
  const line = contact.trim();
  if (line === '') return { phone: null, email: null };
  return line.includes('@') ? { phone: null, email: line } : { phone: line, email: null };
}
