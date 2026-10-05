import { createHash, randomBytes } from 'node:crypto';

/**
 * The two random strings the public link hands out.
 *
 *   the LINK ID    — `/book/<id>`. Not a secret: the shop posts it. Random so
 *                    that it cannot be worked out from a workspace's id, and
 *                    so that resetting it really does retire the old address.
 *   the MANAGE TOKEN — `/my-booking/<token>`. ⚠ A SECRET, and the customer's
 *                    only credential: whoever holds it can see, cancel and move
 *                    that one booking. 256 bits, shown once, stored only as its
 *                    hash — a leaked database row cannot be turned back into a
 *                    working link.
 */

/** Twelve URL-safe characters: 72 bits, far past guessing, short enough to read out. */
export function newPublicLinkId(): string {
  return randomBytes(9).toString('base64url');
}

/** A new manage token, and the hash that is stored in its place. */
export function newManageToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashManageToken(token) };
}

/**
 * The stored form of a manage token. SHA-256, unsalted, on purpose: the token
 * is 256 random bits, so there is no dictionary to defend against, and the
 * hash has to be the lookup key (`manageTokenHash` is unique).
 */
export function hashManageToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
