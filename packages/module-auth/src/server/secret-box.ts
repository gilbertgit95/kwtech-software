import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption for the one secret in this module that a hash cannot
 * protect.
 *
 * **Why this file exists at all.** Everything else stored here is one-way: a
 * password hash and a token hash yield work, not credentials, when a database
 * leaks. A TOTP secret is SYMMETRIC — whoever reads it generates valid codes
 * forever — so hashing is not an option and plaintext defeats the second factor
 * entirely on one dump. The only thing that helps is a key that does not live in
 * the database, which is why `mfaSecretKey` is configuration rather than a
 * column.
 *
 * AES-256-GCM, not CBC or CTR: it authenticates. Without a tag, a stolen row can
 * be *edited* — flip bits in the ciphertext and the plaintext changes
 * predictably — and the verifier would happily derive codes from an attacker's
 * secret while reporting nothing unusual.
 *
 * The stored value is SELF-DESCRIBING, in the same spirit as password.ts:
 *
 *   aesgcm256$v1$<iv-base64>$<tag-base64>$<ciphertext-base64>
 *
 * so a later move to a different cipher, or to per-row key versions, is a new
 * prefix rather than a migration of every enrolled factor.
 */

const SCHEME = 'aesgcm256';
const VERSION = 'v1';
/** 96 bits — GCM's specified nonce size, and the only one it is fast and safe at. */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Turns the configured key into 32 bytes, or explains why it cannot.
 *
 * Accepts base64 or hex and REFUSES anything that does not decode to exactly 32
 * bytes rather than stretching it — a passphrase run through a KDF here would
 * silently accept `"secret"` as a key, and the whole point of this file is that
 * the key is real. `openssl rand -base64 32` is what the error tells the
 * operator to run.
 */
export function readSecretKey(configured: string): Buffer {
  for (const encoding of ['base64', 'hex'] as const) {
    const decoded = Buffer.from(configured, encoding);
    if (decoded.length === KEY_BYTES) return decoded;
  }
  throw new Error(
    'The MFA secret key must decode to exactly 32 bytes of base64 or hex — generate one with `openssl rand -base64 32`. ' +
      'It is not stretched from a passphrase on purpose: that would accept a guessable value as a key.',
  );
}

/** Encrypts, with a fresh IV every time. Reusing one under GCM is catastrophic. */
export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SCHEME, VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('$');
}

/**
 * Decrypts, or returns null.
 *
 * Null rather than a throw, and one null for every cause — wrong scheme,
 * corrupt row, failed tag, rotated key. The endpoint that calls this refuses
 * the sign-in either way, and distinguishing the causes in a response would
 * tell an attacker whether a row they tampered with is being read at all.
 *
 * The realistic cause is a ROTATED KEY, and the recovery path for that is a
 * recovery code — which is the other half of why AuthRecoveryCode exists.
 */
export function open(sealed: string, key: Buffer): string | null {
  const [scheme, version, ivB64, tagB64, ciphertextB64] = sealed.split('$');
  if (scheme !== SCHEME || version !== VERSION || !ivB64 || !tagB64 || !ciphertextB64) return null;

  try {
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    // `final()` is where a failed tag surfaces. It MUST be called — reading
    // only `update()` returns unauthenticated plaintext, which is the classic
    // way GCM gets used as if it were CTR.
    return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
