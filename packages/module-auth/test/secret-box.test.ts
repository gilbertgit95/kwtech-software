import { randomBytes } from 'node:crypto';
import { open, readSecretKey, seal } from '../src/server/secret-box.js';

/**
 * The one secret in this module a hash cannot protect.
 *
 * Everything else stored here is one-way. A TOTP secret is symmetric, so a
 * stolen row generates valid codes forever — these tests pin the two properties
 * that make the difference: it is authenticated, and a wrong key produces
 * nothing rather than garbage.
 */

const KEY = randomBytes(32);

describe('readSecretKey', () => {
  it('accepts 32 bytes of base64 or hex', () => {
    expect(readSecretKey(KEY.toString('base64'))).toEqual(KEY);
    expect(readSecretKey(KEY.toString('hex'))).toEqual(KEY);
  });

  it('REFUSES a passphrase rather than stretching it', () => {
    // Stretching would accept "secret" as a key, and the whole point of the
    // file is that the key is real. The error names the command to run.
    expect(() => readSecretKey('hunter2')).toThrow(/32 bytes/);
    expect(() => readSecretKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('seal / open', () => {
  it('round-trips', () => {
    expect(open(seal('JBSWY3DPEHPK3PXP', KEY), KEY)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('never repeats a ciphertext, because the IV is fresh every time', () => {
    // Reusing a nonce under GCM is catastrophic, so this is not a style point.
    const sealed = new Set(Array.from({ length: 50 }, () => seal('same plaintext', KEY)));
    expect(sealed.size).toBe(50);
  });

  it('is self-describing, so a future cipher is a prefix and not a migration', () => {
    expect(seal('x', KEY)).toMatch(/^aesgcm256\$v1\$/);
  });

  it('returns null for the WRONG KEY — the realistic case is a rotated one', () => {
    // And the recovery path for that is a recovery code, which is the other
    // half of why AuthRecoveryCode exists.
    expect(open(seal('secret', KEY), randomBytes(32))).toBeNull();
  });

  it('DETECTS TAMPERING rather than decrypting to something attacker-chosen', () => {
    // Without the authentication tag a stolen row could be EDITED — flip bits
    // in the ciphertext and the plaintext changes predictably — and the
    // verifier would derive codes from an attacker's secret while reporting
    // nothing unusual.
    const parts = seal('JBSWY3DPEHPK3PXP', KEY).split('$');
    const bytes = Buffer.from(parts[4] ?? '', 'base64');
    bytes.writeUInt8(bytes.readUInt8(0) ^ 0x01, 0);
    parts[4] = bytes.toString('base64');
    expect(open(parts.join('$'), KEY)).toBeNull();
  });

  it('returns null, never throws, for a corrupt or foreign row', () => {
    // One null for every cause: the endpoint refuses either way, and telling
    // the causes apart would say whether a tampered row is being read at all.
    for (const bad of ['', 'nonsense', 'aesgcm256$v2$a$b$c', 'other$v1$a$b$c', 'aesgcm256$v1$a$b$c']) {
      expect(open(bad, KEY)).toBeNull();
    }
  });
});
