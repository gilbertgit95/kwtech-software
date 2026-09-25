import { createHash } from 'node:crypto';
import type { GoogleClientOptions, ResolvedAuthModuleOptions } from '../src/server/auth.options.js';
import { resolveAuthOptions } from '../src/server/auth.options.js';
import type {
  AuthIdentityRow,
  AuthMfaFactorRow,
  AuthPrismaClient,
  AuthUserRow,
} from '../src/server/auth.repository.js';
import { AuthService } from '../src/server/auth.service.js';
import { startGoogleSignIn } from '../src/server/google-oidc.js';
import { TokenService } from '../src/server/token.service.js';
import type { AuthFailureReason } from '../src/types.js';

/**
 * Google sign-in, against a literal client and a stubbed code exchange.
 *
 * The exchange is replaced through the service's own seam (`exchangeGoogleCode`),
 * so these tests are about what the service DECIDES once Google has answered —
 * which account, whether a second factor is still owed, and that every refusal
 * reads the same to the caller.
 */

const NOW = new Date('2026-09-25T12:00:00Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const CONTEXT = { ipAddress: '203.0.113.9', userAgent: 'jest' };
const GOOGLE: GoogleClientOptions = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'not-a-real-secret',
  redirectUri: 'http://localhost:8081/api/auth/google/callback',
};
const INPUT = { code: 'auth-code', codeVerifier: 'verifier', nonce: 'nonce-1' };

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

const claims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: 'https://accounts.google.com',
  aud: GOOGLE.clientId,
  sub: 'google-sub-1',
  email: 'Ada@Example.com',
  email_verified: true,
  name: 'Ada Lovelace',
  exp: NOW_SECONDS + 3600,
  nonce: INPUT.nonce,
  ...over,
});

interface State {
  users?: AuthUserRow[];
  identities?: AuthIdentityRow[];
  factors?: AuthMfaFactorRow[];
  /** What Google "returns". null = the exchange failed. */
  claims?: Record<string, unknown> | null;
  google?: GoogleClientOptions | null;
}

function harness(state: State = {}) {
  const users = state.users ?? [user()];
  const identities = [...(state.identities ?? [])];
  const failures: AuthFailureReason[] = [];
  const writes = { identityCreates: [] as unknown[], identityUpdates: [] as unknown[], sessions: 0 };

  const client = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    authUser: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
        users.find((row) => (where.email ? row.email === where.email : row.id === where.id)) ?? null,
      update: async () => ({}),
    },
    authIdentity: {
      findUnique: async ({ where }: { where: { provider_subject: { provider: string; subject: string } } }) =>
        identities.find(
          (row) => row.provider === where.provider_subject.provider && row.subject === where.provider_subject.subject,
        ) ?? null,
      findFirst: async ({ where }: { where: { userId: string; provider: string } }) =>
        identities.find((row) => row.userId === where.userId && row.provider === where.provider) ?? null,
      create: async (args: { data: AuthIdentityRow }) => {
        // The two @@unique constraints, as the database would enforce them.
        const clash = identities.some(
          (row) =>
            (row.provider === args.data.provider && row.subject === args.data.subject) ||
            (row.userId === args.data.userId && row.provider === args.data.provider),
        );
        if (clash) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        writes.identityCreates.push(args.data);
        identities.push({ ...args.data, id: `i${identities.length + 1}` });
        return { id: `i${identities.length}` };
      },
      update: async (args: unknown) => {
        writes.identityUpdates.push(args);
        return {};
      },
    },
    authMfaFactor: {
      findFirst: async ({ where }: { where: { userId: string; type?: { in: string[] } | string } }) =>
        (state.factors ?? []).find(
          (row) =>
            row.userId === where.userId &&
            row.confirmedAt !== null &&
            (typeof where.type === 'object' ? where.type.in.includes(row.type) : row.type === where.type),
        ) ?? null,
    },
    authSession: {
      create: async () => {
        writes.sessions += 1;
        return { id: `sess${writes.sessions}` };
      },
    },
  } as unknown as AuthPrismaClient;

  const google = state.google === null ? {} : { google: state.google ?? GOOGLE };
  const options: ResolvedAuthModuleOptions = {
    jwtSecret: 'test-secret-not-a-real-one',
    issuer: 'kwtech-test',
    audience: 'kwtech-test-api',
    mfaIssuerLabel: 'KWTech',
    ...google,
    onAuthFailure: (event) => {
      failures.push(event.reason);
    },
  };

  const answer = state.claims === undefined ? claims() : state.claims;
  class Stubbed extends AuthService {
    readonly exchanges: { code: string; codeVerifier: string }[] = [];
    protected override now(): Date {
      return NOW;
    }
    protected override async exchangeGoogleCode(
      _google: GoogleClientOptions,
      input: { code: string; codeVerifier: string },
    ): Promise<Record<string, unknown> | null> {
      this.exchanges.push(input);
      return answer;
    }
  }

  const tokens = new TokenService(options);
  return { svc: new Stubbed(options, tokens, client), tokens, writes, failures, identities };
}

const googleRefusal = async (promise: Promise<unknown>, failures: AuthFailureReason[]) => {
  await expect(promise).rejects.toThrow('Could not sign in with Google');
  return failures.at(-1);
};

describe('signInWithGoogle — which account', () => {
  it('signs in the user a linked identity names, and stamps the identity', async () => {
    const h = harness({
      identities: [
        {
          id: 'i1',
          userId: 'u1',
          provider: 'google',
          subject: 'google-sub-1',
          email: 'ada@example.com',
          emailVerifiedByProvider: true,
        },
      ],
      // The address Google reports now belongs to nobody here; it must not matter.
      claims: claims({ email: 'renamed@elsewhere.example', email_verified: false }),
    });

    const result = await h.svc.signInWithGoogle(INPUT, CONTEXT);

    expect(result.user.id).toBe('u1');
    expect(result.scope).toBe('full');
    expect(h.writes.identityUpdates).toHaveLength(1);
    expect(h.writes.identityCreates).toHaveLength(0);
    // The code and verifier reached the exchange untouched.
    expect(h.svc.exchanges).toEqual([{ code: 'auth-code', codeVerifier: 'verifier' }]);
  });

  it('links a new Google account to the account with its verified, normalised address', async () => {
    const h = harness();
    const result = await h.svc.signInWithGoogle(INPUT, CONTEXT);

    expect(result.user.id).toBe('u1');
    expect(h.writes.identityCreates).toEqual([
      expect.objectContaining({
        userId: 'u1',
        provider: 'google',
        subject: 'google-sub-1',
        email: 'ada@example.com',
        emailVerifiedByProvider: true,
        displayName: 'Ada Lovelace',
      }),
    ]);
  });

  it('refuses to link on an address Google has not verified', async () => {
    const h = harness({ claims: claims({ email_verified: false }) });
    expect(await googleRefusal(h.svc.signInWithGoogle(INPUT, CONTEXT), h.failures)).toBe('federated_email_unverified');
    expect(h.writes.identityCreates).toHaveLength(0);
    expect(h.writes.sessions).toBe(0);
  });

  it('refuses a Google account with no local account — and creates none', async () => {
    const h = harness({ claims: claims({ email: 'stranger@example.com' }) });
    expect(await googleRefusal(h.svc.signInWithGoogle(INPUT, CONTEXT), h.failures)).toBe('federated_no_account');
    expect(h.writes.sessions).toBe(0);
  });

  it('refuses a second Google account for an account that already has one', async () => {
    const h = harness({
      identities: [
        {
          id: 'i1',
          userId: 'u1',
          provider: 'google',
          subject: 'a-different-sub',
          email: 'ada@example.com',
          emailVerifiedByProvider: true,
        },
      ],
    });
    expect(await googleRefusal(h.svc.signInWithGoogle(INPUT, CONTEXT), h.failures)).toBe('federated_already_linked');
  });
});

describe('signInWithGoogle — the same rules as a password', () => {
  it('still owes a confirmed second factor: Google is not a way around it', async () => {
    const h = harness({
      factors: [
        {
          id: 'f1',
          userId: 'u1',
          type: 'totp',
          label: 'iPhone',
          secret: 'sealed',
          confirmedAt: new Date('2026-01-01'),
          lastUsedAt: null,
          lastUsedStep: null,
        },
      ],
    });

    const result = await h.svc.signInWithGoogle(INPUT, CONTEXT);
    expect(result.scope).toBe('mfa');
    expect(result.mfaRequired).toBe(true);
    expect(h.tokens.verifyAccess(result.accessToken)).toMatchObject({ scope: 'mfa' });
  });

  it('counts an email factor as a second factor too', async () => {
    const h = harness({
      factors: [
        {
          id: 'f2',
          userId: 'u1',
          type: 'email',
          label: 'Email',
          secret: '',
          confirmedAt: new Date('2026-01-01'),
          lastUsedAt: null,
          lastUsedStep: null,
        },
      ],
    });
    expect((await h.svc.signInWithGoogle(INPUT, CONTEXT)).scope).toBe('mfa');
  });

  it('refuses a suspended account', async () => {
    const h = harness({ users: [user({ status: 'suspended' })] });
    expect(await googleRefusal(h.svc.signInWithGoogle(INPUT, CONTEXT), h.failures)).toBe('account_suspended');
  });

  it('refuses a locked account', async () => {
    const h = harness({ users: [user({ lockedUntil: new Date(NOW.getTime() + 60_000) })] });
    expect(await googleRefusal(h.svc.signInWithGoogle(INPUT, CONTEXT), h.failures)).toBe('account_locked');
  });
});

describe('signInWithGoogle — every failure reads the same', () => {
  it('refuses when Google refused the code', async () => {
    const h = harness({ claims: null });
    expect(await googleRefusal(h.svc.signInWithGoogle(INPUT, CONTEXT), h.failures)).toBe('federated_exchange_failed');
  });

  it('refuses an ID token answering another attempt', async () => {
    const h = harness({ claims: claims({ nonce: 'someone-elses' }) });
    expect(await googleRefusal(h.svc.signInWithGoogle(INPUT, CONTEXT), h.failures)).toBe('federated_token_invalid');
  });

  it('refuses when Google is not configured', async () => {
    const h = harness({ google: null });
    expect(await googleRefusal(h.svc.signInWithGoogle(INPUT, CONTEXT), h.failures)).toBe('federated_not_configured');
    expect(h.svc.signInProviders()).toEqual({ google: false });
    expect(() => h.svc.startGoogleSignIn()).toThrow('Google sign-in is not enabled.');
  });
});

describe('startGoogleSignIn', () => {
  it('sends the S256 challenge of the verifier, never the verifier itself', () => {
    const start = startGoogleSignIn(GOOGLE);
    const url = new URL(start.authorizationUrl);

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(GOOGLE.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(GOOGLE.redirectUri);
    expect(url.searchParams.get('state')).toBe(start.state);
    expect(url.searchParams.get('nonce')).toBe(start.nonce);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(start.codeVerifier).digest('base64url'),
    );
    expect(start.authorizationUrl).not.toContain(start.codeVerifier);
    expect(url.searchParams.has('client_secret')).toBe(false);
  });

  it('mints fresh values every time', () => {
    const a = startGoogleSignIn(GOOGLE);
    const b = startGoogleSignIn(GOOGLE);
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe('the Google client from the environment', () => {
  const NAMES = ['AUTH_GOOGLE_CLIENT_ID', 'AUTH_GOOGLE_CLIENT_SECRET', 'AUTH_GOOGLE_REDIRECT_URI'] as const;
  const saved = NAMES.map((name) => process.env[name]);

  afterEach(() => {
    for (const [index, name] of NAMES.entries()) {
      const value = saved[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const resolve = () => resolveAuthOptions({ jwtSecret: 'x'.repeat(40) });

  it('is off when none of the three is set', () => {
    for (const name of NAMES) delete process.env[name];
    expect(resolve().google).toBeUndefined();
  });

  it('treats empty values as unset', () => {
    for (const name of NAMES) process.env[name] = '';
    expect(resolve().google).toBeUndefined();
  });

  it('is on when all three are set', () => {
    process.env.AUTH_GOOGLE_CLIENT_ID = 'id';
    process.env.AUTH_GOOGLE_CLIENT_SECRET = 'secret';
    process.env.AUTH_GOOGLE_REDIRECT_URI = 'http://localhost:8081/api/auth/google/callback';
    expect(resolve().google).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:8081/api/auth/google/callback',
    });
  });

  it('fails the boot when half configured, naming what is missing', () => {
    process.env.AUTH_GOOGLE_CLIENT_ID = 'id';
    delete process.env.AUTH_GOOGLE_CLIENT_SECRET;
    delete process.env.AUTH_GOOGLE_REDIRECT_URI;
    expect(resolve).toThrow('missing AUTH_GOOGLE_CLIENT_SECRET, AUTH_GOOGLE_REDIRECT_URI');
  });
});
