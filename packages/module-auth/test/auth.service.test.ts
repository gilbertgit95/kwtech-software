import type { AuthModuleOptions } from '../src/server/auth.options.js';
import type {
  AuthPasswordResetRow,
  AuthPrismaClient,
  AuthSessionRow,
  AuthUserRow,
} from '../src/server/auth.repository.js';
import { AuthService } from '../src/server/auth.service.js';
import { hashPassword } from '../src/server/password.js';
import { TokenService } from '../src/server/token.service.js';
import type { AuthFailureReason } from '../src/types.js';

jest.setTimeout(30_000);

/**
 * The security properties of the credential path, exercised against a literal
 * object rather than a database — the same payoff the structural client gives
 * @kwtech/module-permissions.
 *
 * Nearly every test here is about what the caller is NOT told.
 */

const PASSWORD = 'correct horse battery staple';
const CONTEXT = { ipAddress: '203.0.113.9', userAgent: 'jest' };

const OPTIONS: AuthModuleOptions = {
  jwtSecret: 'test-secret-not-a-real-one',
  issuer: 'kwtech-test',
  audience: 'kwtech-test-api',
};

interface State {
  user?: AuthUserRow | null;
  secret?: string;
  session?: AuthSessionRow | null;
  reset?: AuthPasswordResetRow | null;
  rotateWins?: boolean;
  consumeWins?: boolean;
}

interface Writes {
  userUpdates: unknown[];
  sessionCreates: unknown[];
  sessionUpdates: unknown[];
  credentialUpserts: unknown[];
  resetCreates: unknown[];
  resetUpdates: unknown[];
}

const user = (over: Partial<AuthUserRow> = {}): AuthUserRow => ({
  id: 'u1',
  email: 'ada@example.com',
  username: 'ada',
  displayName: 'Ada',
  status: 'active',
  failedLoginCount: 0,
  lockedUntil: null,
  ...over,
});

function harness(state: State = {}) {
  const writes: Writes = {
    userUpdates: [],
    sessionCreates: [],
    sessionUpdates: [],
    credentialUpserts: [],
    resetCreates: [],
    resetUpdates: [],
  };
  const failures: AuthFailureReason[] = [];
  const emails: { token: string; expiresAt: Date }[] = [];

  const client = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    authUser: {
      findUnique: async () => state.user ?? null,
      findFirst: async () => state.user ?? null,
      update: async (args: unknown) => {
        writes.userUpdates.push(args);
        return {};
      },
    },
    authCredential: {
      findFirst: async () => (state.secret ? { id: 'c1', secret: state.secret } : null),
      upsert: async (args: unknown) => {
        writes.credentialUpserts.push(args);
        return {};
      },
    },
    authSession: {
      findUnique: async () => state.session ?? null,
      create: async (args: unknown) => {
        writes.sessionCreates.push(args);
        return { id: 'sess1' };
      },
      updateMany: async (args: unknown) => {
        writes.sessionUpdates.push(args);
        return { count: state.rotateWins === false ? 0 : 1 };
      },
    },
    authPasswordReset: {
      findUnique: async () => state.reset ?? null,
      create: async (args: unknown) => {
        writes.resetCreates.push(args);
        return { id: 'pr1' };
      },
      updateMany: async (args: unknown) => {
        writes.resetUpdates.push(args);
        return { count: state.consumeWins === false ? 0 : 1 };
      },
    },
  } as unknown as AuthPrismaClient;

  const options: AuthModuleOptions = {
    ...OPTIONS,
    onAuthFailure: (event) => failures.push(event.reason),
    sendPasswordResetEmail: async ({ token, expiresAt }) => {
      emails.push({ token, expiresAt });
    },
  };

  const tokens = new TokenService(options);
  return { svc: new AuthService(options, tokens, client), tokens, writes, failures, emails, state };
}

/** The reason an operator would see, for a call the caller is told nothing about. */
const failureOf = async (promise: Promise<unknown>, failures: AuthFailureReason[]) => {
  await expect(promise).rejects.toThrow('Invalid email or password');
  return failures.at(-1);
};

describe('signIn — one answer for every failure', () => {
  it('signs in and returns both tokens', async () => {
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD) });
    const result = await h.svc.signIn({ identifier: 'ada@example.com', password: PASSWORD }, CONTEXT);

    expect(result.user).toEqual({ id: 'u1', email: 'ada@example.com', username: 'ada', displayName: 'Ada' });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.scope).toBe('full');
    expect(h.tokens.verifyAccess(result.accessToken)).toMatchObject({ userId: 'u1', sessionId: 'sess1' });
  });

  it('normalises the address before looking it up', async () => {
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD) });
    await expect(
      h.svc.signIn({ identifier: '  ADA@Example.COM ', password: PASSWORD }, CONTEXT),
    ).resolves.toBeDefined();
  });

  it('accepts a USERNAME in the same field', async () => {
    // One field, and unambiguous: a username may not contain '@', so the two
    // namespaces cannot overlap.
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD) });
    await expect(h.svc.signIn({ identifier: 'Gilbert95', password: PASSWORD }, CONTEXT)).resolves.toBeDefined();
  });

  it('refuses a malformed identifier exactly like an unknown one', async () => {
    // Saying "that is not a valid email" would tell an attacker which of their
    // guesses are worth trying at all.
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD) });
    expect(await failureOf(h.svc.signIn({ identifier: 'no', password: PASSWORD }, CONTEXT), h.failures)).toBe(
      'unknown_email',
    );
  });

  it('stores only the HASH of the refresh token', async () => {
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD) });
    const result = await h.svc.signIn({ identifier: 'ada@example.com', password: PASSWORD }, CONTEXT);

    // A database read — a backup, a support query, a leaked dump — must not
    // yield a working session.
    const created = h.writes.sessionCreates[0] as { data: { refreshTokenHash: string } };
    expect(created.data.refreshTokenHash).toBe(h.tokens.hashOpaque(result.refreshToken));
    expect(JSON.stringify(h.writes.sessionCreates)).not.toContain(result.refreshToken);
  });

  it('clears the lockout counter on success', async () => {
    const h = harness({ user: user({ failedLoginCount: 4 }), secret: await hashPassword(PASSWORD) });
    await h.svc.signIn({ identifier: 'ada@example.com', password: PASSWORD }, CONTEXT);
    expect(h.writes.userUpdates[0]).toMatchObject({ data: { failedLoginCount: 0, lockedUntil: null } });
  });

  it.each([
    ['an unknown address', {}, 'unknown_email'],
    ['a user with no password credential', { user: user() }, 'no_password_credential'],
  ])('refuses %s with the same message', async (_label, state, expected) => {
    const h = harness(state as State);
    expect(
      await failureOf(h.svc.signIn({ identifier: 'ada@example.com', password: PASSWORD }, CONTEXT), h.failures),
    ).toBe(expected);
  });

  it('refuses the wrong password and counts it', async () => {
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD) });
    expect(
      await failureOf(
        h.svc.signIn({ identifier: 'ada@example.com', password: 'wrong password!!' }, CONTEXT),
        h.failures,
      ),
    ).toBe('wrong_password');
    expect(h.writes.userUpdates[0]).toMatchObject({ data: { failedLoginCount: 1 } });
  });

  it('refuses a locked account even on the RIGHT password', async () => {
    // Otherwise the lockout is an oracle that confirms a correct guess.
    const h = harness({
      user: user({ lockedUntil: new Date(Date.now() + 60_000) }),
      secret: await hashPassword(PASSWORD),
    });
    expect(
      await failureOf(h.svc.signIn({ identifier: 'ada@example.com', password: PASSWORD }, CONTEXT), h.failures),
    ).toBe('account_locked');
    expect(h.writes.sessionCreates).toHaveLength(0);
  });

  it('refuses a suspended account after the password checks out', async () => {
    const h = harness({ user: user({ status: 'suspended' }), secret: await hashPassword(PASSWORD) });
    expect(
      await failureOf(h.svc.signIn({ identifier: 'ada@example.com', password: PASSWORD }, CONTEXT), h.failures),
    ).toBe('account_suspended');
  });

  it('spends hashing time even when the address does not exist', async () => {
    // The timing oracle: 'no such user' returning in a millisecond while
    // 'wrong password' takes the ~100ms scrypt costs answers the question the
    // status code refuses to.
    const known = harness({ user: user(), secret: await hashPassword(PASSWORD) });
    const unknown = harness({});

    const timeOf = async (run: () => Promise<unknown>) => {
      const started = process.hrtime.bigint();
      await run().catch(() => undefined);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    const wrongPassword = await timeOf(() =>
      known.svc.signIn({ identifier: 'ada@example.com', password: 'wrong password!!' }, CONTEXT),
    );
    const noSuchUser = await timeOf(() =>
      unknown.svc.signIn({ identifier: 'nobody@example.com', password: PASSWORD }, CONTEXT),
    );

    // Both pay for a scrypt. The ratio is the assertion, not the absolute time.
    expect(noSuchUser).toBeGreaterThan(wrongPassword * 0.25);
  });
});

describe('refresh — rotation, not reuse', () => {
  const liveSession = (over: Partial<AuthSessionRow> = {}): AuthSessionRow => ({
    id: 'sess1',
    userId: 'u1',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    user: user(),
    ...over,
  });

  it('issues a NEW refresh token and spends the old one', async () => {
    const h = harness({ session: liveSession() });
    const result = await h.svc.refresh('presented-token', CONTEXT);

    expect(result.refreshToken).not.toBe('presented-token');
    const update = h.writes.sessionUpdates[0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    // Conditional on the OLD hash: that condition is the whole mechanism.
    expect(update.where).toMatchObject({
      id: 'sess1',
      refreshTokenHash: h.tokens.hashOpaque('presented-token'),
      revokedAt: null,
    });
    expect(update.data.refreshTokenHash).toBe(h.tokens.hashOpaque(result.refreshToken));
  });

  it('refuses when another refresh won the race', async () => {
    // Two callers holding the same token is indistinguishable from a stolen
    // one, so neither is trusted.
    const h = harness({ session: liveSession(), rotateWins: false });
    expect(await failureOf(h.svc.refresh('presented-token', CONTEXT), h.failures)).toBe('session_revoked');
  });

  it.each([
    ['an unknown token', {}, 'session_unknown'],
    ['a revoked session', { session: liveSession({ revokedAt: new Date() }) }, 'session_revoked'],
    ['an expired session', { session: liveSession({ expiresAt: new Date(Date.now() - 1) }) }, 'session_expired'],
    ['a suspended user', { session: liveSession({ user: user({ status: 'suspended' }) }) }, 'account_suspended'],
  ])('refuses %s', async (_label, state, expected) => {
    const h = harness(state as State);
    expect(await failureOf(h.svc.refresh('presented-token', CONTEXT), h.failures)).toBe(expected);
  });
});

describe('signOut', () => {
  it('revokes the session named by the principal', async () => {
    const h = harness();
    await expect(h.svc.signOut({ userId: 'u1', sessionId: 'sess1', scope: 'full', expiresAt: 0 })).resolves.toEqual({
      revoked: true,
    });
    expect(h.writes.sessionUpdates[0]).toMatchObject({ where: { id: 'sess1', revokedAt: null } });
  });

  it('is idempotent — signing out twice is not an error', async () => {
    const h = harness({ rotateWins: false });
    await expect(h.svc.signOut({ userId: 'u1', sessionId: 'sess1', scope: 'full', expiresAt: 0 })).resolves.toEqual({
      revoked: false,
    });
  });
});

describe('requestPasswordReset — the same answer either way', () => {
  it('accepts and emails a link for a real account', async () => {
    const h = harness({ user: user() });
    await expect(h.svc.requestPasswordReset({ email: 'ada@example.com' }, CONTEXT)).resolves.toEqual({
      accepted: true,
    });
    expect(h.emails).toHaveLength(1);
  });

  it('accepts identically for an address with no account', async () => {
    // A form that says 'no account with that email' is an enumeration oracle
    // that needs no password guessing at all.
    const h = harness({});
    await expect(h.svc.requestPasswordReset({ email: 'nobody@example.com' }, CONTEXT)).resolves.toEqual({
      accepted: true,
    });
    expect(h.emails).toHaveLength(0);
    expect(h.failures.at(-1)).toBe('unknown_email');
  });

  it('accepts identically for a suspended account', async () => {
    const h = harness({ user: user({ status: 'suspended' }) });
    await expect(h.svc.requestPasswordReset({ email: 'ada@example.com' }, CONTEXT)).resolves.toEqual({
      accepted: true,
    });
    expect(h.emails).toHaveLength(0);
  });

  it('stores only the hash, and hands the raw token to the mailer alone', async () => {
    const h = harness({ user: user() });
    await h.svc.requestPasswordReset({ email: 'ada@example.com' }, CONTEXT);

    const raw = h.emails[0]?.token as string;
    const created = h.writes.resetCreates[0] as { data: { tokenHash: string } };
    expect(created.data.tokenHash).toBe(h.tokens.hashOpaque(raw));
    expect(JSON.stringify(h.writes.resetCreates)).not.toContain(raw);
  });

  it('invalidates outstanding requests first, so three clicks leave one live link', async () => {
    const h = harness({ user: user() });
    await h.svc.requestPasswordReset({ email: 'ada@example.com' }, CONTEXT);
    expect(h.writes.resetUpdates[0]).toMatchObject({ where: { userId: 'u1', consumedAt: null } });
  });

  it('refuses to mint a token when no mailer is configured', async () => {
    // Minting one nobody can receive would look like it worked and lock the
    // user out quietly.
    const tokens = new TokenService(OPTIONS);
    const svc = new AuthService(OPTIONS, tokens, {} as never);
    await expect(svc.requestPasswordReset({ email: 'ada@example.com' }, CONTEXT)).rejects.toThrow(
      /requires sendPasswordResetEmail/,
    );
  });
});

describe('resetPassword', () => {
  const liveReset = (over: Partial<AuthPasswordResetRow> = {}): AuthPasswordResetRow => ({
    id: 'pr1',
    userId: 'u1',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    user: user(),
    ...over,
  });

  it('sets the new password, consumes the token and revokes every session', async () => {
    // The step people skip: someone resetting a stolen password is not helped
    // by a reset that leaves the thief signed in.
    const h = harness({ reset: liveReset() });
    await expect(h.svc.resetPassword({ token: 'raw', password: PASSWORD }, CONTEXT)).resolves.toEqual({ reset: true });

    expect(h.writes.credentialUpserts).toHaveLength(1);
    expect(h.writes.resetUpdates[0]).toMatchObject({ where: { id: 'pr1', consumedAt: null } });
    expect(h.writes.sessionUpdates[0]).toMatchObject({ where: { userId: 'u1', revokedAt: null } });
  });

  it('clears the lockout, so the brute-force victim is not left locked out', async () => {
    const h = harness({ reset: liveReset() });
    await h.svc.resetPassword({ token: 'raw', password: PASSWORD }, CONTEXT);
    expect(h.writes.userUpdates[0]).toMatchObject({ data: { failedLoginCount: 0, lockedUntil: null } });
  });

  it('stores a verifiable hash, never the password', async () => {
    const h = harness({ reset: liveReset() });
    await h.svc.resetPassword({ token: 'raw', password: PASSWORD }, CONTEXT);
    const upsert = h.writes.credentialUpserts[0] as { create: { secret: string } };
    expect(upsert.create.secret).toMatch(/^scrypt\$/);
    expect(upsert.create.secret).not.toContain(PASSWORD);
  });

  it.each([
    ['an unknown token', {}, 'reset_token_unknown'],
    ['an already-used token', { reset: liveReset({ consumedAt: new Date() }) }, 'reset_token_consumed'],
    ['an expired token', { reset: liveReset({ expiresAt: new Date(Date.now() - 1) }) }, 'reset_token_expired'],
  ])('refuses %s', async (_label, state, expected) => {
    const h = harness(state as State);
    expect(await failureOf(h.svc.resetPassword({ token: 'raw', password: PASSWORD }, CONTEXT), h.failures)).toBe(
      expected,
    );
  });

  it('refuses when a concurrent click consumed the token first', async () => {
    const h = harness({ reset: liveReset(), consumeWins: false });
    await expect(h.svc.resetPassword({ token: 'raw', password: PASSWORD }, CONTEXT)).rejects.toThrow();
    expect(h.writes.credentialUpserts).toHaveLength(0);
  });

  it('rejects a weak password BEFORE looking the token up, and says why', async () => {
    // The one thing on this path the caller should be told precisely: it is
    // about the value they just chose, not about whether an account exists.
    const h = harness({ reset: liveReset() });
    await expect(h.svc.resetPassword({ token: 'raw', password: 'short' }, CONTEXT)).rejects.toMatchObject({
      response: { reason: 'weak_password' },
    });
    expect(h.writes.credentialUpserts).toHaveLength(0);
  });

  it('rejects a long but obvious password', async () => {
    const h = harness({ reset: liveReset() });
    await expect(h.svc.resetPassword({ token: 'raw', password: 'password1234' }, CONTEXT)).rejects.toMatchObject({
      response: { reason: 'weak_password' },
    });
  });
});

describe('a host that bound no client', () => {
  it('fails with a message naming the option, not a missing method', async () => {
    const svc = new AuthService(OPTIONS, new TokenService(OPTIONS));
    await expect(svc.signIn({ identifier: 'a@b.com', password: PASSWORD }, CONTEXT)).rejects.toThrow(
      /Bind AUTH_PRISMA/,
    );
  });
});
