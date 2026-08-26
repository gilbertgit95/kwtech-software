import { randomBytes } from 'node:crypto';
import { RECOVERY_CODE_COUNT, totpStepAt } from '../src/domain/policy.js';
import type { ResolvedAuthModuleOptions } from '../src/server/auth.options.js';
import type {
  AuthMfaFactorRow,
  AuthPrismaClient,
  AuthRecoveryCodeRow,
  AuthSessionRow,
  AuthUserRow,
} from '../src/server/auth.repository.js';
import { AuthService } from '../src/server/auth.service.js';
import { hashPassword } from '../src/server/password.js';
import { seal } from '../src/server/secret-box.js';
import { TokenService } from '../src/server/token.service.js';
import { totpCodeAt } from '../src/server/totp.js';
import type { AuthFailureReason, Principal } from '../src/types.js';

jest.setTimeout(60_000);

/**
 * The second factor, against a literal object rather than a database.
 *
 * The tests that matter most here are the ones about what a HALF-ADMITTED
 * session cannot do: the whole value of the `mfa` scope is that holding one
 * gets you to exactly one endpoint, and that waiting fifteen minutes and
 * refreshing does not quietly upgrade it.
 */

const PASSWORD = 'correct horse battery staple';
const CONTEXT = { ipAddress: '203.0.113.9', userAgent: 'jest' };
const MFA_KEY = randomBytes(32).toString('base64');
/** RFC 6238's test secret, in base32. */
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const NOW = new Date(1_700_000_000_000);
const STEP = totpStepAt(NOW);
const codeAt = (offset = 0) => totpCodeAt(SECRET, STEP + offset) as string;

const user = (over: Partial<AuthUserRow> = {}): AuthUserRow => ({
  id: 'u1',
  email: 'ada@example.com',
  username: 'ada',
  displayName: 'Ada',
  status: 'active',
  failedLoginCount: 0,
  lockedUntil: null,
  mfaRequiredAt: null,
  ...over,
});

const factor = (over: Partial<AuthMfaFactorRow> = {}): AuthMfaFactorRow => ({
  id: 'f1',
  userId: 'u1',
  type: 'totp',
  label: 'iPhone',
  secret: seal(SECRET, Buffer.from(MFA_KEY, 'base64')),
  confirmedAt: new Date('2026-01-01'),
  lastUsedAt: null,
  lastUsedStep: null,
  ...over,
});

const session = (over: Partial<AuthSessionRow> = {}): AuthSessionRow => ({
  id: 'sess1',
  userId: 'u1',
  expiresAt: new Date(NOW.getTime() + 86_400_000),
  revokedAt: null,
  mfaSatisfiedAt: null,
  user: user(),
  ...over,
});

const principal = (over: Partial<Principal> = {}): Principal => ({
  userId: 'u1',
  sessionId: 'sess1',
  scope: 'mfa',
  expiresAt: Math.floor(NOW.getTime() / 1000) + 900,
  issuedAt: Math.floor(NOW.getTime() / 1000),
  ...over,
});

interface State {
  user?: AuthUserRow | null;
  secret?: string;
  factors?: AuthMfaFactorRow[];
  recoveryCodes?: AuthRecoveryCodeRow[];
  session?: AuthSessionRow | null;
  /** false when a concurrent request already spent the step or the code. */
  spendWins?: boolean;
  mfaSecretKey?: string | undefined;
}

function harness(state: State = {}) {
  const writes = {
    userUpdates: [] as unknown[],
    sessionUpdates: [] as unknown[],
    factorCreates: [] as unknown[],
    factorUpdates: [] as unknown[],
    factorDeletes: [] as unknown[],
    recoveryCreates: [] as unknown[],
    recoveryUpdates: [] as unknown[],
    recoveryDeletes: [] as unknown[],
  };
  const failures: AuthFailureReason[] = [];

  const confirmedOnly = (rows: AuthMfaFactorRow[], want: unknown) =>
    want === undefined ? rows : want === null ? rows.filter((f) => !f.confirmedAt) : rows.filter((f) => f.confirmedAt);

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
      upsert: async () => ({}),
    },
    authSession: {
      findUnique: async () => state.session ?? null,
      create: async () => ({ id: 'sess1' }),
      updateMany: async (args: unknown) => {
        writes.sessionUpdates.push(args);
        return { count: 1 };
      },
    },
    authMfaFactor: {
      findFirst: async (args: { where: { confirmedAt?: unknown } }) =>
        confirmedOnly(state.factors ?? [], args.where.confirmedAt)[0] ?? null,
      findMany: async (args: { where: { confirmedAt?: unknown } }) =>
        confirmedOnly(state.factors ?? [], args.where.confirmedAt),
      create: async (args: unknown) => {
        writes.factorCreates.push(args);
        return { id: 'f1' };
      },
      updateMany: async (args: unknown) => {
        writes.factorUpdates.push(args);
        return { count: state.spendWins === false ? 0 : 1 };
      },
      deleteMany: async (args: unknown) => {
        writes.factorDeletes.push(args);
        return { count: 1 };
      },
    },
    authRecoveryCode: {
      findMany: async () => state.recoveryCodes ?? [],
      createMany: async (args: unknown) => {
        writes.recoveryCreates.push(args);
        return { count: RECOVERY_CODE_COUNT };
      },
      updateMany: async (args: unknown) => {
        writes.recoveryUpdates.push(args);
        return { count: state.spendWins === false ? 0 : 1 };
      },
      deleteMany: async (args: unknown) => {
        writes.recoveryDeletes.push(args);
        return { count: 1 };
      },
    },
    authPasswordReset: {
      findUnique: async () => null,
      create: async () => ({ id: 'pr1' }),
      updateMany: async () => ({ count: 1 }),
    },
  } as unknown as AuthPrismaClient;

  // `exactOptionalPropertyTypes` makes an explicit `undefined` different from an
  // absent key, and the difference is the point here: "no key configured" has to
  // be the key being ABSENT, which is what an app that never set
  // AUTH_MFA_SECRET_KEY produces.
  const configuredKey = 'mfaSecretKey' in state ? state.mfaSecretKey : MFA_KEY;
  const options: ResolvedAuthModuleOptions = {
    jwtSecret: 'test-secret-not-a-real-one',
    issuer: 'kwtech-test',
    audience: 'kwtech-test-api',
    mfaIssuerLabel: 'KWTech',
    ...(configuredKey === undefined ? {} : { mfaSecretKey: configuredKey }),
    onAuthFailure: (event) => {
      failures.push(event.reason);
    },
  };

  const tokens = new TokenService(options);
  // The clock is pinned so a code minted for STEP is the code "now" — otherwise
  // every one of these tests would be a flake waiting for a step boundary.
  class Fixed extends AuthService {
    protected override now(): Date {
      return NOW;
    }
  }
  return { svc: new Fixed(options, tokens, client), tokens, writes, failures };
}

const refusalOf = async (promise: Promise<unknown>, failures: AuthFailureReason[]) => {
  await expect(promise).rejects.toThrow('Invalid email or password');
  return failures.at(-1);
};

// ── sign-in ──────────────────────────────────────────────────────────────────

describe('signIn — a confirmed factor makes the session half-admitted', () => {
  it('issues an `mfa` scope, not a `full` one, when a confirmed factor exists', async () => {
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD), factors: [factor()] });
    const result = await h.svc.signIn({ identifier: 'ada@example.com', password: PASSWORD }, CONTEXT);

    expect(result.scope).toBe('mfa');
    expect(result.mfaRequired).toBe(true);
    expect(h.tokens.verifyAccess(result.accessToken)).toMatchObject({ scope: 'mfa' });
  });

  it('ignores an UNCONFIRMED factor — it grants nothing and blocks nothing', async () => {
    // The column that stops a mis-scanned QR code locking someone out of their
    // own account with a factor they can never satisfy.
    const h = harness({
      user: user(),
      secret: await hashPassword(PASSWORD),
      factors: [factor({ confirmedAt: null })],
    });
    expect((await h.svc.signIn({ identifier: 'ada@example.com', password: PASSWORD }, CONTEXT)).scope).toBe('full');
  });

  it('does not stamp lastLoginAt until the sign-in is actually finished', async () => {
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD), factors: [factor()] });
    await h.svc.signIn({ identifier: 'ada@example.com', password: PASSWORD }, CONTEXT);
    expect(h.writes.userUpdates[0]).not.toMatchObject({ data: { lastLoginAt: expect.anything() } });
  });
});

// ── the property the whole scope exists for ──────────────────────────────────

describe('refresh — the scope is re-derived, never carried over', () => {
  it('REFUSES TO UPGRADE a session that never satisfied its factor', async () => {
    // Without this, the `mfa` scope is decorative: sign in, wait fifteen
    // minutes, refresh, and be `full` for having done nothing.
    const h = harness({
      user: user(),
      factors: [factor()],
      session: session({ mfaSatisfiedAt: null }),
    });
    const result = await h.svc.refresh('any-token', CONTEXT);

    expect(result.scope).toBe('mfa');
    expect(result.mfaRequired).toBe(true);
  });

  it('issues `full` once the session has satisfied it', async () => {
    const h = harness({ user: user(), factors: [factor()], session: session({ mfaSatisfiedAt: NOW }) });
    expect((await h.svc.refresh('any-token', CONTEXT)).scope).toBe('full');
  });

  it('issues `full` for an account with no factor at all', async () => {
    const h = harness({ user: user(), session: session() });
    expect((await h.svc.refresh('any-token', CONTEXT)).scope).toBe('full');
  });
});

// ── the challenge ────────────────────────────────────────────────────────────

describe('verifyMfa', () => {
  it('accepts a current code and returns a full session', async () => {
    const h = harness({ user: user(), factors: [factor()], session: session() });
    const result = await h.svc.verifyMfa(principal(), { code: codeAt() }, CONTEXT);

    expect(result.scope).toBe('full');
    expect(result.mfaRequired).toBe(false);
    expect(h.tokens.verifyAccess(result.accessToken)).toMatchObject({ scope: 'full', sessionId: 'sess1' });
  });

  it('accepts a code with the spaces a user pasted in', async () => {
    const h = harness({ user: user(), factors: [factor()], session: session() });
    const spaced = `${codeAt().slice(0, 3)} ${codeAt().slice(3)}`;
    await expect(h.svc.verifyMfa(principal(), { code: spaced }, CONTEXT)).resolves.toBeDefined();
  });

  it('ROTATES the refresh token, retiring the half-admitted one', async () => {
    // The old token could only ever buy an `mfa` access token. Leaving it valid
    // would make it the credential for a `full` one.
    const h = harness({ user: user(), factors: [factor()], session: session() });
    const result = await h.svc.verifyMfa(principal(), { code: codeAt() }, CONTEXT);

    const upgrade = h.writes.sessionUpdates[0] as { data: { refreshTokenHash: string; mfaSatisfiedAt: Date } };
    expect(upgrade.data.refreshTokenHash).toBe(h.tokens.hashOpaque(result.refreshToken));
    expect(upgrade.data.mfaSatisfiedAt).toEqual(NOW);
  });

  it('SPENDS THE STEP, conditionally, so the same code cannot be replayed', async () => {
    const h = harness({ user: user(), factors: [factor()], session: session() });
    await h.svc.verifyMfa(principal(), { code: codeAt() }, CONTEXT);

    // The condition is in the WHERE clause, not in application code: two
    // requests carrying the same code race in the database and one wins.
    expect(h.writes.factorUpdates[0]).toMatchObject({
      where: { OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(STEP) } }] },
      data: { lastUsedStep: BigInt(STEP) },
    });
  });

  it('refuses a code whose step is already recorded as used', async () => {
    const h = harness({ user: user(), factors: [factor({ lastUsedStep: BigInt(STEP) })], session: session() });
    expect(await refusalOf(h.svc.verifyMfa(principal(), { code: codeAt() }, CONTEXT), h.failures)).toBe(
      'mfa_code_invalid',
    );
    expect(h.failures).toContain('mfa_code_replayed');
  });

  it('refuses when a concurrent request won the race for the same step', async () => {
    const h = harness({ user: user(), factors: [factor()], session: session(), spendWins: false });
    await expect(h.svc.verifyMfa(principal(), { code: codeAt() }, CONTEXT)).rejects.toThrow();
    expect(h.failures).toContain('mfa_code_replayed');
  });

  it('counts a wrong code towards the SAME lockout as a wrong password', async () => {
    // Separate counters would hand an attacker who already holds the password a
    // fresh budget of guesses at the six digits that are all that remain.
    // The counter comes off the row joined to the session — one query, and the
    // fixture has to say so.
    const h = harness({ factors: [factor()], session: session({ user: user({ failedLoginCount: 3 }) }) });
    expect(await refusalOf(h.svc.verifyMfa(principal(), { code: '000000' }, CONTEXT), h.failures)).toBe(
      'mfa_code_invalid',
    );
    expect(h.writes.userUpdates[0]).toMatchObject({ data: { failedLoginCount: 4 } });
  });

  it('refuses even a RIGHT code while the account is locked', async () => {
    // Or the lockout becomes an oracle that confirms a correct guess.
    const h = harness({
      user: user({ lockedUntil: new Date(NOW.getTime() + 60_000) }),
      factors: [factor()],
      session: session({ user: user({ lockedUntil: new Date(NOW.getTime() + 60_000) }) }),
    });
    expect(await refusalOf(h.svc.verifyMfa(principal(), { code: codeAt() }, CONTEXT), h.failures)).toBe(
      'account_locked',
    );
  });

  it('refuses a revoked session even with a valid code', async () => {
    const h = harness({ user: user(), factors: [factor()], session: session({ revokedAt: NOW }) });
    expect(await refusalOf(h.svc.verifyMfa(principal(), { code: codeAt() }, CONTEXT), h.failures)).toBe(
      'session_revoked',
    );
  });

  it('refuses when every factor was revoked between sign-in and now', async () => {
    const h = harness({ user: user(), factors: [], session: session() });
    expect(await refusalOf(h.svc.verifyMfa(principal(), { code: codeAt() }, CONTEXT), h.failures)).toBe(
      'mfa_no_factor',
    );
  });

  it('skips a factor it cannot decrypt instead of failing the request', async () => {
    // A rotated key. Another factor may still work, and a recovery code
    // certainly will — so one unreadable row must not be the end of it.
    const stale = factor({ id: 'f0', secret: seal(SECRET, randomBytes(32)) });
    const h = harness({ user: user(), factors: [stale, factor()], session: session() });
    await expect(h.svc.verifyMfa(principal(), { code: codeAt() }, CONTEXT)).resolves.toBeDefined();
  });
});

describe('verifyMfa — recovery codes', () => {
  const CODE = 'AAAAABBBBBCCCCCD';

  it('accepts a recovery code in the same field and marks it used', async () => {
    const h = harness({
      user: user(),
      factors: [factor()],
      session: session(),
      recoveryCodes: [{ id: 'r1', userId: 'u1', codeHash: await hashPassword(CODE), usedAt: null }],
    });
    const result = await h.svc.verifyMfa(principal(), { code: CODE }, CONTEXT);

    expect(result.scope).toBe('full');
    // Conditional on still being unused, so the same code presented twice
    // concurrently is spent once.
    expect(h.writes.recoveryUpdates[0]).toMatchObject({ where: { id: 'r1', usedAt: null } });
  });

  it('refuses an unknown recovery code with the same message as a wrong TOTP', async () => {
    const h = harness({ user: user(), factors: [factor()], session: session(), recoveryCodes: [] });
    expect(await refusalOf(h.svc.verifyMfa(principal(), { code: CODE }, CONTEXT), h.failures)).toBe('mfa_code_invalid');
    expect(h.failures).toContain('recovery_code_unknown');
  });
});

// ── enrolment ────────────────────────────────────────────────────────────────

describe('enrolMfa', () => {
  const full = principal({ scope: 'full' });

  it('refuses without the current password, even on a valid session', async () => {
    // A stolen cookie must not be enough to add an authenticator the real owner
    // does not hold — which would lock them out with a factor the attacker
    // controls.
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD) });
    expect(await refusalOf(h.svc.enrolMfa(full, { password: 'wrong password!!', label: 'iPhone' }), h.failures)).toBe(
      'wrong_password',
    );
  });

  it('STORES CIPHERTEXT, never the secret it hands back', async () => {
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD) });
    const enrolment = await h.svc.enrolMfa(full, { password: PASSWORD, label: 'iPhone' });

    const created = h.writes.factorCreates[0] as { data: { secret: string } };
    expect(created.data.secret).toMatch(/^aesgcm256\$v1\$/);
    expect(created.data.secret).not.toContain(enrolment.secret);
  });

  it('creates the factor UNCONFIRMED, so it grants nothing until proved', async () => {
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD) });
    await h.svc.enrolMfa(full, { password: PASSWORD, label: 'iPhone' });
    expect((h.writes.factorCreates[0] as { data: Record<string, unknown> }).data.confirmedAt).toBeUndefined();
  });

  it('clears an abandoned enrolment first', async () => {
    // An unconfirmed row grants nothing and blocks nothing, but would collide
    // with @@unique([userId, label]) the next time the same name is used.
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD) });
    await h.svc.enrolMfa(full, { password: PASSWORD, label: 'iPhone' });
    expect(h.writes.factorDeletes[0]).toMatchObject({ where: { userId: 'u1', confirmedAt: null } });
  });

  it('returns a URI an authenticator app can scan', async () => {
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD) });
    const enrolment = await h.svc.enrolMfa(full, { password: PASSWORD, label: 'iPhone' });
    expect(enrolment.uri).toContain('otpauth://totp/KWTech:ada?');
    expect(enrolment.uri).toContain(`secret=${enrolment.secret}`);
  });

  it('REFUSES AS A CONFIGURATION ERROR, not an auth failure, with no key set', async () => {
    // Reporting it as a 401 would hide an operator mistake in the one log line
    // the whole module is designed to make uninformative.
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD), mfaSecretKey: undefined });
    await expect(h.svc.enrolMfa(full, { password: PASSWORD, label: 'iPhone' })).rejects.toThrow(/AUTH_MFA_SECRET_KEY/);
  });
});

describe('confirmMfa', () => {
  const full = principal({ scope: 'full' });

  it('activates the factor, hands out recovery codes and revokes every other session', async () => {
    const h = harness({
      user: user(),
      secret: await hashPassword(PASSWORD),
      factors: [factor({ confirmedAt: null })],
    });
    const { codes } = await h.svc.confirmMfa(full, { factorId: 'f1', code: codeAt() });

    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    expect(h.writes.factorUpdates[0]).toMatchObject({ data: { confirmedAt: NOW } });

    // Sessions opened BEFORE this moment have mfaSatisfiedAt: null and would be
    // challenged on their next refresh, minutes later, with no explanation.
    expect(h.writes.sessionUpdates[0]).toMatchObject({
      where: { userId: 'u1', revokedAt: null, NOT: { id: 'sess1' } },
      data: { revokedAt: NOW },
    });
    // …except this one, which just proved the factor.
    expect(h.writes.sessionUpdates[1]).toMatchObject({ where: { id: 'sess1' }, data: { mfaSatisfiedAt: NOW } });
  });

  it('stores only HASHES of the recovery codes', async () => {
    const h = harness({ user: user(), factors: [factor({ confirmedAt: null })] });
    const { codes } = await h.svc.confirmMfa(full, { factorId: 'f1', code: codeAt() });

    const created = JSON.stringify(h.writes.recoveryCreates);
    for (const code of codes) expect(created).not.toContain(code);
    expect(created).toContain('scrypt$');
  });

  it('records the confirming step, so the same code cannot start the session', async () => {
    const h = harness({ user: user(), factors: [factor({ confirmedAt: null })] });
    await h.svc.confirmMfa(full, { factorId: 'f1', code: codeAt() });
    expect(h.writes.factorUpdates[0]).toMatchObject({ data: { lastUsedStep: BigInt(STEP) } });
  });

  it('refuses a wrong code and leaves the factor inert', async () => {
    const h = harness({ user: user(), factors: [factor({ confirmedAt: null })] });
    await expect(h.svc.confirmMfa(full, { factorId: 'f1', code: '000000' })).rejects.toThrow();
    expect(h.writes.factorUpdates).toHaveLength(0);
  });
});

describe('removeMfaFactor', () => {
  const full = principal({ scope: 'full' });

  it('requires the password — stripping a factor is the attacker move too', async () => {
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD), factors: [factor()] });
    expect(
      await refusalOf(h.svc.removeMfaFactor(full, { factorId: 'f1', password: 'wrong password!!' }), h.failures),
    ).toBe('wrong_password');
    expect(h.writes.factorDeletes).toHaveLength(0);
  });

  it('drops the recovery codes with the LAST factor', async () => {
    // They are the way past a second factor; outliving it would leave a set of
    // long-lived credentials recovering nothing.
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD), factors: [] });
    await h.svc.removeMfaFactor(full, { factorId: 'f1', password: PASSWORD });
    expect(h.writes.recoveryDeletes[0]).toMatchObject({ where: { userId: 'u1' } });
  });

  it('keeps them while another factor remains', async () => {
    const h = harness({ user: user(), secret: await hashPassword(PASSWORD), factors: [factor({ id: 'f2' })] });
    await h.svc.removeMfaFactor(full, { factorId: 'f1', password: PASSWORD });
    expect(h.writes.recoveryDeletes).toHaveLength(0);
  });
});
