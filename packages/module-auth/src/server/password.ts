import { randomBytes, type ScryptOptions, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// promisify() picks node's 3-argument scrypt overload, which drops the options
// object silently — and with it N, r and p. Typed explicitly so the parameters
// below are actually applied rather than quietly replaced by the defaults.
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing. In `/server` rather than `/domain` because it needs
 * node:crypto, and the core entrypoint must stay safe to bundle for a browser.
 *
 * scrypt, not argon2id — deliberately. argon2 is the better function, but every
 * binding needs a native build step, and `allowBuilds` in pnpm-workspace.yaml is
 * kept to an explicit short list on purpose (PLAN §2). Adding a compiled
 * dependency to the credential path is not a trade to make quietly.
 *
 * The stored value is SELF-DESCRIBING — the algorithm and its parameters are
 * inside the string:
 *
 *   scrypt$N=16384,r=8,p=1$<salt-base64>$<hash-base64>
 *
 * so moving to argon2id later costs no migration and no forced reset: verify
 * against whatever prefix the row carries, and re-hash on the next successful
 * sign-in.
 */

// 128 * N * r is ~16 MB, comfortably under node's 32 MB default cap. maxmem is
// passed explicitly anyway, so raising N later fails as a deliberate change
// rather than as a confusing runtime error on one machine.
const PARAMS = { N: 16_384, r: 8, p: 1, keyLength: 64, maxmem: 256 * 1024 * 1024 } as const;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(plain.normalize('NFKC'), salt, PARAMS.keyLength, PARAMS);
  return `scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/**
 * Constant-time verification.
 *
 * Returns false on a malformed or unknown-scheme row rather than throwing: a
 * corrupt credential must read as "wrong password" at the sign-in endpoint,
 * never as a 500 — which would tell an attacker the account exists and that
 * something about it is unusual.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, params, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !params || !saltB64 || !hashB64) return false;

  const parsed = Object.fromEntries(params.split(',').map((pair) => pair.split('=')));
  const N = Number(parsed.N);
  const r = Number(parsed.r);
  const p = Number(parsed.p);
  if (!N || !r || !p) return false;

  const expected = Buffer.from(hashB64, 'base64');
  let derived: Buffer;
  try {
    derived = await scrypt(plain.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
      N,
      r,
      p,
      maxmem: PARAMS.maxmem,
    });
  } catch {
    // Absurd parameters in the row — refuse, do not crash the endpoint.
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
