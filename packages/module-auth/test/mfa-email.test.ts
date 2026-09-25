import { EMAIL_MFA_CODE_TTL, EMAIL_MFA_RESEND_SECONDS } from '../src/domain/policy.js';
import type { ResolvedAuthModuleOptions } from '../src/server/auth.options.js';
import type {
  AuthMfaEmailCodeRow,
  AuthMfaFactorRow,
  AuthPrismaClient,
  AuthSessionRow,
  AuthUserRow,
} from '../src/server/auth.repository.js';
import { AuthService } from '../src/server/auth.service.js';
import { hashPassword } from '../src/server/password.js';
import { TokenService } from '../src/server/token.service.js';
import type { AuthFailureReason, Principal } from '../src/types.js';

jest.setTimeout(60_000);

/**
 * The emailed second factor.
 *
 * What matters most is the BINDING: a code is sent because one half-admitted
 * session asked, and only that session may spend it. The rest — single use,
 * expiry, the resend window, enrolment proving the mailbox — follows the rules
 * the TOTP factor already keeps.
 */

const PASSWORD = 'correct horse battery staple';
const CONTEXT = { ipAddress: '203.0.113.9', userAgent: 'jest' };
const NOW = new Date('2026-09-25T12:00:00Z');

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

const emailFactor = (over: Partial<AuthMfaFactorRow> = {}): AuthMfaFactorRow => ({
  id: 'fe',
  userId: 'u1',
  type: 'email',
  label: 'Email',
  secret: '',
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
  user?: AuthUserRow;
  session?: AuthSessionRow | null;
  factors?: AuthMfaFactorRow[];
  codes?: AuthMfaEmailCodeRow[];
  mailer?: boolean;
  mailFails?: boolean;
}

function harness(state: State = {}) {
  const factors = [...(state.factors ?? [])];
  const codes = [...(state.codes ?? [])];
  const sent: { code: string; purpose: string; expiresAt: Date }[] = [];
  const failures: AuthFailureReason[] = [];
  const writes = { userUpdates: [] as unknown[], sessionUpdates: [] as unknown[] };

  const typeMatches = (row: AuthMfaFactorRow, type: unknown) =>
    type === undefined ||
    (typeof type === 'object' && type !== null ? (type as { in: string[] }).in.includes(row.type) : row.type === type);
  const confirmedMatches = (row: AuthMfaFactorRow, want: unknown) =>
    want === undefined || (want === null ? row.confirmedAt === null : row.confirmedAt !== null);
  const factorWhere = (where: { userId: string; id?: string; type?: unknown; confirmedAt?: unknown }) =>
    factors.filter(
      (row) =>
        row.userId === where.userId &&
        (where.id === undefined || row.id === where.id) &&
        typeMatches(row, where.type) &&
        confirmedMatches(row, where.confirmedAt),
    );

  const client = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    authUser: {
      findUnique: async () => state.user ?? user(),
      update: async (args: unknown) => {
        writes.userUpdates.push(args);
        return {};
      },
    },
    authCredential: {
      findFirst: async () => ({ id: 'c1', secret: await hashPassword(PASSWORD) }),
    },
    authSession: {
      findUnique: async () => (state.session === undefined ? session() : state.session),
      findMany: async () => [],
      updateMany: async (args: unknown) => {
        writes.sessionUpdates.push(args);
        return { count: 1 };
      },
    },
    authMfaFactor: {
      findFirst: async ({ where }: { where: Parameters<typeof factorWhere>[0] }) => factorWhere(where)[0] ?? null,
      findMany: async ({ where }: { where: Parameters<typeof factorWhere>[0] }) => factorWhere(where),
      create: async ({
        data,
      }: {
        data: Omit<AuthMfaFactorRow, 'id' | 'confirmedAt' | 'lastUsedAt' | 'lastUsedStep'>;
      }) => {
        factors.push({ ...data, id: 'new-factor', confirmedAt: null, lastUsedAt: null, lastUsedStep: null });
        return { id: 'new-factor' };
      },
      updateMany: async ({ where, data }: { where: { id: string }; data: Partial<AuthMfaFactorRow> }) => {
        const row = factors.find((factor) => factor.id === where.id);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
      deleteMany: async ({ where }: { where: { userId: string; confirmedAt?: null } }) => {
        const before = factors.length;
        for (let i = factors.length - 1; i >= 0; i -= 1) {
          if (where.confirmedAt === null && factors[i]?.confirmedAt === null) factors.splice(i, 1);
        }
        return { count: before - factors.length };
      },
    },
    authMfaEmailCode: {
      findFirst: async ({ where }: { where: { userId: string; sessionId: string } }) =>
        codes
          .filter((row) => row.userId === where.userId && row.sessionId === where.sessionId && row.consumedAt === null)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      create: async ({ data }: { data: Omit<AuthMfaEmailCodeRow, 'id' | 'createdAt' | 'consumedAt'> }) => {
        codes.push({ ...data, id: `code${codes.length + 1}`, createdAt: NOW, consumedAt: null });
        return { id: `code${codes.length}` };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: string; sessionId?: string };
        data: { consumedAt: Date };
      }) => {
        const hits = codes.filter(
          (row) =>
            row.consumedAt === null &&
            (where.id === undefined || row.id === where.id) &&
            (where.sessionId === undefined || row.sessionId === where.sessionId),
        );
        for (const row of hits) row.consumedAt = data.consumedAt;
        return { count: hits.length };
      },
    },
    authRecoveryCode: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 10 }),
    },
  } as unknown as AuthPrismaClient;

  const options: ResolvedAuthModuleOptions = {
    jwtSecret: 'test-secret-not-a-real-one',
    issuer: 'kwtech-test',
    audience: 'kwtech-test-api',
    mfaIssuerLabel: 'KWTech',
    ...(state.mailer === false
      ? {}
      : {
          sendMfaEmailCode: async (input) => {
            if (state.mailFails) throw new Error('SMTP is down');
            sent.push({ code: input.code, purpose: input.purpose, expiresAt: input.expiresAt });
          },
        }),
    onAuthFailure: (event) => {
      failures.push(event.reason);
    },
  };

  class Fixed extends AuthService {
    protected override now(): Date {
      return NOW;
    }
  }
  return { svc: new Fixed(options, new TokenService(options), client), sent, codes, factors, failures, writes };
}

/** A code row as issueEmailCode would have written it. */
async function issued(code: string, over: Partial<AuthMfaEmailCodeRow> = {}): Promise<AuthMfaEmailCodeRow> {
  return {
    id: 'code-x',
    userId: 'u1',
    sessionId: 'sess1',
    codeHash: await hashPassword(code),
    createdAt: new Date(NOW.getTime() - 60_000),
    expiresAt: new Date(NOW.getTime() + 60_000),
    consumedAt: null,
    ...over,
  };
}

describe('sendMfaEmailCode — at the sign-in challenge', () => {
  it('sends six digits, stores only a hash, and binds it to this session', async () => {
    const h = harness({ factors: [emailFactor()] });
    const result = await h.svc.sendMfaEmailCode(principal(), CONTEXT);

    expect(result.sent).toBe(true);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.code).toMatch(/^\d{6}$/);
    expect(h.sent[0]?.purpose).toBe('sign_in');
    expect(h.codes).toHaveLength(1);
    expect(h.codes[0]?.sessionId).toBe('sess1');
    expect(h.codes[0]?.codeHash).not.toContain(h.sent[0]?.code ?? 'x');
    expect(h.codes[0]?.expiresAt.getTime()).toBe(NOW.getTime() + EMAIL_MFA_CODE_TTL * 1000);
  });

  it('answers sent:false, and sends nothing, for an account with no email factor', async () => {
    const h = harness({ factors: [] });
    expect(await h.svc.sendMfaEmailCode(principal(), CONTEXT)).toEqual({ sent: false, expiresAt: null });
    expect(h.sent).toHaveLength(0);
  });

  it('refuses another code inside the resend window', async () => {
    const h = harness({
      factors: [emailFactor()],
      codes: [await issued('123456', { createdAt: new Date(NOW.getTime() - 5_000) })],
    });
    await expect(h.svc.sendMfaEmailCode(principal(), CONTEXT)).rejects.toThrow(`${EMAIL_MFA_RESEND_SECONDS} seconds`);
    expect(h.failures).toContain('mfa_email_resend_too_soon');
    expect(h.sent).toHaveLength(0);
  });

  it('consumes the older live code when it sends a new one', async () => {
    const h = harness({ factors: [emailFactor()], codes: [await issued('123456')] });
    await h.svc.sendMfaEmailCode(principal(), CONTEXT);
    expect(h.codes.filter((row) => row.consumedAt === null)).toHaveLength(1);
    expect(h.codes[0]?.consumedAt).toEqual(NOW);
  });

  it('refuses a locked account rather than mailing a code it cannot spend', async () => {
    const locked = user({ lockedUntil: new Date(NOW.getTime() + 60_000) });
    const h = harness({ factors: [emailFactor()], session: session({ user: locked }) });
    await expect(h.svc.sendMfaEmailCode(principal(), CONTEXT)).rejects.toThrow('Invalid email or password');
    expect(h.sent).toHaveLength(0);
  });

  it('reports a failed send as a sentence, not a 500', async () => {
    const h = harness({ factors: [emailFactor()], mailFails: true });
    await expect(h.svc.sendMfaEmailCode(principal(), CONTEXT)).rejects.toThrow('Could not send the code');
  });
});

describe('verifyMfa — with an emailed code', () => {
  it('accepts the code sent to this session, spends it, and upgrades to full', async () => {
    const h = harness({ factors: [emailFactor()], codes: [await issued('246810')] });
    const result = await h.svc.verifyMfa(principal(), { code: '246 810' }, CONTEXT);

    expect(result.scope).toBe('full');
    expect(h.codes[0]?.consumedAt).toEqual(NOW);
    expect(h.factors[0]?.lastUsedAt).toEqual(NOW);
  });

  it('refuses a code that was sent to a DIFFERENT sign-in', async () => {
    const h = harness({ factors: [emailFactor()], codes: [await issued('246810', { sessionId: 'someone-elses' })] });
    await expect(h.svc.verifyMfa(principal(), { code: '246810' }, CONTEXT)).rejects.toThrow();
    expect(h.failures.at(-1)).toBe('mfa_code_invalid');
  });

  it('refuses an expired code', async () => {
    const h = harness({
      factors: [emailFactor()],
      codes: [await issued('246810', { expiresAt: new Date(NOW.getTime() - 1) })],
    });
    await expect(h.svc.verifyMfa(principal(), { code: '246810' }, CONTEXT)).rejects.toThrow();
  });

  it('refuses a wrong code and counts it towards the lockout', async () => {
    const h = harness({ factors: [emailFactor()], codes: [await issued('246810')] });
    await expect(h.svc.verifyMfa(principal(), { code: '111111' }, CONTEXT)).rejects.toThrow();
    expect(h.writes.userUpdates).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ failedLoginCount: 1 }) }),
    ]);
    expect(h.codes[0]?.consumedAt).toBeNull();
  });

  it('refuses a code already spent', async () => {
    const h = harness({ factors: [emailFactor()], codes: [await issued('246810', { consumedAt: NOW })] });
    await expect(h.svc.verifyMfa(principal(), { code: '246810' }, CONTEXT)).rejects.toThrow();
  });
});

describe('enrolEmailMfa → confirmMfa', () => {
  it('requires the password', async () => {
    const h = harness();
    await expect(h.svc.enrolEmailMfa(principal({ scope: 'full' }), { password: 'wrong' })).rejects.toThrow();
    expect(h.sent).toHaveLength(0);
  });

  it('refuses without a mailer, rather than creating a factor nobody can prove', async () => {
    const h = harness({ mailer: false });
    await expect(h.svc.enrolEmailMfa(principal({ scope: 'full' }), { password: PASSWORD })).rejects.toThrow(
      'sendMfaEmailCode',
    );
    expect(h.factors).toHaveLength(0);
  });

  it('creates an UNCONFIRMED factor and sends a code, which confirmMfa then accepts', async () => {
    const h = harness();
    const enrolment = await h.svc.enrolEmailMfa(principal({ scope: 'full' }), { password: PASSWORD });

    expect(enrolment.sentTo).toBe('ada@example.com');
    expect(h.factors).toEqual([expect.objectContaining({ type: 'email', confirmedAt: null })]);
    expect(h.sent[0]?.purpose).toBe('enrolment');

    const code = h.sent[0]?.code ?? '';
    const recovery = await h.svc.confirmMfa(principal({ scope: 'full' }), { factorId: enrolment.factorId, code });

    expect(recovery.codes).toHaveLength(10);
    expect(h.factors[0]?.confirmedAt).toEqual(NOW);
    // An email factor has no TOTP step to record.
    expect(h.factors[0]?.lastUsedStep).toBeNull();
  });

  it('refuses a wrong code at confirmation and leaves the factor off', async () => {
    const h = harness();
    const enrolment = await h.svc.enrolEmailMfa(principal({ scope: 'full' }), { password: PASSWORD });
    const wrong = h.sent[0]?.code === '000000' ? '111111' : '000000';

    await expect(
      h.svc.confirmMfa(principal({ scope: 'full' }), { factorId: enrolment.factorId, code: wrong }),
    ).rejects.toThrow();
    expect(h.factors[0]?.confirmedAt).toBeNull();
  });

  it('refuses a second email factor', async () => {
    const h = harness({ factors: [emailFactor()] });
    await expect(h.svc.enrolEmailMfa(principal({ scope: 'full' }), { password: PASSWORD })).rejects.toThrow(
      'already on',
    );
  });
});
