import { decodeJwtPayload, planFederatedSignIn, prepareGoogleIdentity } from '../src/domain/federated.js';
import { canSendEmailMfaCode, EMAIL_MFA_RESEND_SECONDS, isPlausibleEmailMfaCode } from '../src/domain/policy.js';

/**
 * The pure half of Google sign-in: what an ID token has to say before it is
 * believed, and which account a believed identity may reach. Every refusal
 * here is one an attacker would otherwise get to skip, so each has a test.
 */

const NOW = new Date('2026-09-25T12:00:00Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const NONCE = 'nonce-abc';

const claims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: '1098765',
  email: 'Ada@Example.com',
  email_verified: true,
  name: 'Ada Lovelace',
  iat: NOW_SECONDS - 5,
  exp: NOW_SECONDS + 3600,
  nonce: NONCE,
  ...over,
});

const prepare = (over: Record<string, unknown> = {}) =>
  prepareGoogleIdentity(claims(over), { clientId: CLIENT_ID, nonce: NONCE, now: NOW });

const jwt = (payload: unknown) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'signature'].join('.');

describe('decodeJwtPayload', () => {
  it('reads the middle segment as JSON', () => {
    expect(decodeJwtPayload(jwt({ sub: 'x', name: 'Zoë' }))).toEqual({ sub: 'x', name: 'Zoë' });
  });

  it.each([
    ['not three segments', 'a.b'],
    ['not base64 JSON', 'a.!!!.c'],
    ['an array, not an object', jwt([1, 2])],
    ['a bare string', jwt('hello')],
  ])('refuses %s', (_label, token) => {
    expect(decodeJwtPayload(token)).toBeNull();
  });
});

describe('prepareGoogleIdentity', () => {
  it('turns good claims into an identity, keyed by sub', () => {
    expect(prepare()).toEqual({
      identity: {
        provider: 'google',
        subject: '1098765',
        email: 'Ada@Example.com',
        emailVerifiedByProvider: true,
        displayName: 'Ada Lovelace',
      },
    });
  });

  it('accepts both spellings of the Google issuer', () => {
    expect(prepare({ iss: 'accounts.google.com' })).toHaveProperty('identity');
  });

  it('accepts an audience array that contains this client', () => {
    expect(prepare({ aud: ['someone-else', CLIENT_ID] })).toHaveProperty('identity');
  });

  it.each([
    ['another issuer', { iss: 'https://evil.example' }],
    ['a token issued to another client', { aud: 'someone-else.apps.googleusercontent.com' }],
    ['an expired token', { exp: NOW_SECONDS - 120 }],
    ['a token from the future', { iat: NOW_SECONDS + 600 }],
    ['a nonce from another attempt', { nonce: 'other' }],
    ['no nonce at all', { nonce: undefined }],
    ['no subject', { sub: undefined }],
    ['an empty subject', { sub: '' }],
  ])('refuses %s', (_label, over) => {
    expect(prepare(over)).toEqual({ refused: 'federated_token_invalid' });
  });

  it('forgives a little clock skew on expiry', () => {
    expect(prepare({ exp: NOW_SECONDS - 30 })).toHaveProperty('identity');
  });

  it('refuses when the EXPECTED nonce is empty, even if the claim is empty too', () => {
    // An empty expected nonce matching an empty claim would be no check at all.
    expect(prepareGoogleIdentity(claims({ nonce: '' }), { clientId: CLIENT_ID, nonce: '', now: NOW })).toEqual({
      refused: 'federated_token_invalid',
    });
  });

  it.each([
    [true, true],
    ['true', true],
    [false, false],
    ['yes', false],
    [undefined, false],
  ])('email_verified %p reads as %p', (value, expected) => {
    const prepared = prepare({ email_verified: value });
    expect('identity' in prepared && prepared.identity.emailVerifiedByProvider).toBe(expected);
  });
});

describe('planFederatedSignIn', () => {
  const verified = { emailVerifiedByProvider: true };
  const unverified = { emailVerifiedByProvider: false };

  it('signs in the linked user, whatever the address says', () => {
    expect(
      planFederatedSignIn({
        linkedUserId: 'u1',
        userWithEmail: { id: 'someone-else' },
        userHasProviderIdentity: false,
        identity: unverified,
      }),
    ).toEqual({ kind: 'sign_in', userId: 'u1' });
  });

  it('links an unlinked identity to the account with its VERIFIED address', () => {
    expect(
      planFederatedSignIn({
        linkedUserId: null,
        userWithEmail: { id: 'u1' },
        userHasProviderIdentity: false,
        identity: verified,
      }),
    ).toEqual({ kind: 'link', userId: 'u1' });
  });

  it('refuses to link on an UNVERIFIED address — email is never a match key on its own', () => {
    expect(
      planFederatedSignIn({
        linkedUserId: null,
        userWithEmail: { id: 'u1' },
        userHasProviderIdentity: false,
        identity: unverified,
      }),
    ).toEqual({ kind: 'refuse', reason: 'federated_email_unverified' });
  });

  it('refuses when no account exists — there is no sign-up', () => {
    expect(
      planFederatedSignIn({
        linkedUserId: null,
        userWithEmail: null,
        userHasProviderIdentity: false,
        identity: verified,
      }),
    ).toEqual({ kind: 'refuse', reason: 'federated_no_account' });
  });

  it('refuses to link a second Google account to an account that has one', () => {
    expect(
      planFederatedSignIn({
        linkedUserId: null,
        userWithEmail: { id: 'u1' },
        userHasProviderIdentity: true,
        identity: verified,
      }),
    ).toEqual({ kind: 'refuse', reason: 'federated_already_linked' });
  });
});

describe('email second-factor policy', () => {
  it('allows the first code, and another only after the resend window', () => {
    expect(canSendEmailMfaCode(null, NOW)).toBe(true);
    expect(canSendEmailMfaCode(new Date(NOW.getTime() - 5_000), NOW)).toBe(false);
    expect(canSendEmailMfaCode(new Date(NOW.getTime() - EMAIL_MFA_RESEND_SECONDS * 1000), NOW)).toBe(true);
  });

  it.each([
    ['123456', true],
    ['012345', true],
    ['12345', false],
    ['1234567', false],
    ['12a456', false],
  ])('%s is plausible: %p', (code, expected) => {
    expect(isPlausibleEmailMfaCode(code)).toBe(expected);
  });
});
