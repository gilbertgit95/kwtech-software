import { InMemoryRevocationStore } from '../src/server/revocation.js';

/**
 * The denylist, which is what makes sign-out immediate.
 *
 * Without it, revoking a session sets a column nothing reads until the next
 * refresh, so a revoked or stolen access token keeps working for the rest of its
 * life. Lowering `AUTH_ACCESS_TOKEN_TTL` bounds that window; only this closes it.
 *
 * The cases below are the ones where a wrong answer is a security bug rather
 * than an inconvenience: a token in flight at the moment of revocation, and a
 * token minted by a legitimate sign-in immediately afterwards.
 */

const NOW = () => Math.floor(Date.now() / 1000);
const token = (over: Partial<{ userId: string; sessionId: string; issuedAt: number }> = {}) => ({
  userId: 'u1',
  sessionId: 'sess-a',
  issuedAt: NOW(),
  ...over,
});

describe('InMemoryRevocationStore — by session', () => {
  it('lets an unrevoked token through', () => {
    expect(new InMemoryRevocationStore().isRevoked(token())).toBe(false);
  });

  it('refuses a revoked session immediately', () => {
    const store = new InMemoryRevocationStore();
    store.revokeSessions(['sess-a'], 300);
    expect(store.isRevoked(token())).toBe(true);
  });

  it('leaves the same user’s OTHER sessions alone', () => {
    // "Sign out this device" must not sign out the others, and change-password
    // deliberately spares the session that performed it.
    const store = new InMemoryRevocationStore();
    store.revokeSessions(['sess-a'], 300);
    expect(store.isRevoked(token({ sessionId: 'sess-b' }))).toBe(false);
  });
});

describe('InMemoryRevocationStore — by user', () => {
  it('refuses every session with ONE entry', () => {
    // One entry however many sessions existed — which is why this scales, and
    // why it also covers sessions the revoking query never named.
    const store = new InMemoryRevocationStore();
    store.revokeUserBefore('u1', NOW(), 300);
    for (const sessionId of ['sess-a', 'sess-b', 'sess-c']) {
      expect(store.isRevoked(token({ sessionId }))).toBe(true);
    }
  });

  it('CATCHES A TOKEN THAT WAS IN FLIGHT', () => {
    // Minted a second before the revocation and still travelling. A denylist
    // keyed only on session ids known at revoke time would miss it.
    const store = new InMemoryRevocationStore();
    const at = NOW();
    store.revokeUserBefore('u1', at, 300);
    expect(store.isRevoked(token({ sessionId: 'in-flight', issuedAt: at - 1 }))).toBe(true);
  });

  it('catches a token minted in the SAME second', () => {
    // `<=`, not `<`. Refusing it costs one re-sign-in; accepting it is the hole.
    const store = new InMemoryRevocationStore();
    const at = NOW();
    store.revokeUserBefore('u1', at, 300);
    expect(store.isRevoked(token({ issuedAt: at }))).toBe(true);
  });

  it('LETS A NEW SIGN-IN THROUGH', () => {
    // The other half, and the reason `issuedAt` exists rather than `expiresAt`:
    // signing out everywhere must not stop you signing back in.
    const store = new InMemoryRevocationStore();
    const at = NOW();
    store.revokeUserBefore('u1', at, 300);
    expect(store.isRevoked(token({ sessionId: 'fresh', issuedAt: at + 1 }))).toBe(false);
  });

  it('does not touch another user', () => {
    const store = new InMemoryRevocationStore();
    store.revokeUserBefore('u1', NOW(), 300);
    expect(store.isRevoked(token({ userId: 'u2' }))).toBe(false);
  });

  it('keeps the LATER cut-off when revoked twice', () => {
    // An earlier revocation arriving second must not narrow what the later one
    // already refused.
    const store = new InMemoryRevocationStore();
    const at = NOW();
    store.revokeUserBefore('u1', at, 300);
    store.revokeUserBefore('u1', at - 60, 300);
    expect(store.isRevoked(token({ issuedAt: at }))).toBe(true);
  });
});

describe('InMemoryRevocationStore — it stays small', () => {
  it('drops entries once they can no longer matter', () => {
    // Entries live exactly as long as an access token can. After that the token
    // is refused by its own expiry and the entry is dead weight — which is what
    // keeps this a handful of keys rather than a growing table.
    const store = new InMemoryRevocationStore();
    store.revokeSessions(['gone'], 0);
    store.revokeUserBefore('u9', NOW(), 0);
    expect(store.isRevoked(token({ sessionId: 'gone' }))).toBe(false);
    expect(store.size()).toEqual({ sessions: 0, users: 0 });
  });
});
