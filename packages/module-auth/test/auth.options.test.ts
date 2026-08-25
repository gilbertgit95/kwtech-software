import { AuthModule } from '../src/server/auth.module.js';
import {
  DEFAULT_TOKEN_AUDIENCE,
  DEFAULT_TOKEN_ISSUER,
  parseDuration,
  resolveAuthOptions,
} from '../src/server/auth.options.js';

/**
 * The two-line setup is a promise the README makes; these are the tests that
 * make it one. Every case here is something an app would otherwise discover by
 * booting.
 */

const ENV_KEYS = [
  'AUTH_JWT_SECRET',
  'AUTH_TOKEN_ISSUER',
  'AUTH_TOKEN_AUDIENCE',
  'AUTH_SESSION_TTL',
  'AUTH_ACCESS_TOKEN_TTL',
  'AUTH_PASSWORD_RESET_TTL',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('parseDuration', () => {
  it('reads the units an operator writes', () => {
    expect(parseDuration('30s')).toBe(30);
    expect(parseDuration('15m')).toBe(900);
    expect(parseDuration('24h')).toBe(86_400);
    expect(parseDuration('7d')).toBe(604_800);
  });

  it('refuses a bare number rather than guessing seconds or milliseconds', () => {
    expect(parseDuration('900')).toBeNull();
  });

  it('refuses malformed input', () => {
    expect(parseDuration(undefined)).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('7 days')).toBeNull();
    expect(parseDuration('d7')).toBeNull();
  });
});

describe('resolveAuthOptions', () => {
  it('needs only a secret in the environment', () => {
    process.env.AUTH_JWT_SECRET = 'from-the-environment';

    const resolved = resolveAuthOptions({});

    expect(resolved.jwtSecret).toBe('from-the-environment');
    expect(resolved.issuer).toBe(DEFAULT_TOKEN_ISSUER);
    expect(resolved.audience).toBe(DEFAULT_TOKEN_AUDIENCE);
  });

  it('refuses to boot with no secret anywhere, rather than inventing one', () => {
    expect(() => resolveAuthOptions({})).toThrow(/AUTH_JWT_SECRET/);
  });

  it('lets an explicit value win over the environment', () => {
    process.env.AUTH_JWT_SECRET = 'from-the-environment';
    process.env.AUTH_TOKEN_ISSUER = 'env-issuer';

    const resolved = resolveAuthOptions({ jwtSecret: 'explicit', issuer: 'explicit-issuer' });

    expect(resolved.jwtSecret).toBe('explicit');
    expect(resolved.issuer).toBe('explicit-issuer');
  });

  it('reads the TTLs the policy file says it reads', () => {
    process.env.AUTH_JWT_SECRET = 's';
    process.env.AUTH_SESSION_TTL = '2d';
    process.env.AUTH_ACCESS_TOKEN_TTL = '5m';
    process.env.AUTH_PASSWORD_RESET_TTL = '30m';

    const resolved = resolveAuthOptions({});

    expect(resolved.sessionTtl).toBe(172_800);
    expect(resolved.accessTokenTtl).toBe(300);
    expect(resolved.passwordResetTtl).toBe(1800);
  });

  it('leaves TTLs unset when the environment is silent, so the policy default applies', () => {
    process.env.AUTH_JWT_SECRET = 's';

    const resolved = resolveAuthOptions({});

    expect(resolved.sessionTtl).toBeUndefined();
    expect('sessionTtl' in resolved).toBe(false);
  });

  it('throws on a malformed TTL instead of silently ignoring it', () => {
    process.env.AUTH_JWT_SECRET = 's';
    // A bare number is the mistake worth catching: 15 seconds looks like a bug
    // in the app, not like a configuration error.
    process.env.AUTH_ACCESS_TOKEN_TTL = '15';

    expect(() => resolveAuthOptions({})).toThrow(/AUTH_ACCESS_TOKEN_TTL/);
  });

  it('rejects a session shorter than the access token it issues', () => {
    process.env.AUTH_JWT_SECRET = 's';
    process.env.AUTH_SESSION_TTL = '5m';
    process.env.AUTH_ACCESS_TOKEN_TTL = '15m';

    expect(() => resolveAuthOptions({})).toThrow(/must be longer/);
  });
});

describe('AuthModule.forRoot', () => {
  it('wires from the environment alone — the two-line setup the README promises', () => {
    process.env.AUTH_JWT_SECRET = 'from-the-environment';

    const dynamic = AuthModule.forRoot({});

    expect(dynamic.module).toBe(AuthModule);
    expect(dynamic.global).toBe(true);
    expect(dynamic.controllers).toHaveLength(1);
  });

  it('still fails at BOOT, not at first sign-in, when the secret is missing', () => {
    expect(() => AuthModule.forRoot({})).toThrow(/AUTH_JWT_SECRET/);
  });
});
