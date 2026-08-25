import jwt from 'jsonwebtoken';
import type { ResolvedAuthModuleOptions } from '../src/server/auth.options.js';
import { TokenService } from '../src/server/token.service.js';

const OPTIONS: ResolvedAuthModuleOptions = {
  jwtSecret: 'test-secret-not-a-real-one',
  issuer: 'kwtech-test',
  audience: 'kwtech-test-api',
};

const service = (over: Partial<ResolvedAuthModuleOptions> = {}) => new TokenService({ ...OPTIONS, ...over });

describe('issueAccess / verifyAccess', () => {
  it('round-trips a principal', () => {
    const svc = service();
    const { accessToken } = svc.issueAccess({ userId: 'u1', sessionId: 's1', scope: 'full' });

    expect(svc.verifyAccess(accessToken)).toMatchObject({ userId: 'u1', sessionId: 's1', scope: 'full' });
  });

  it('reports an expiry the client can schedule against', () => {
    const { expiresAt } = service().issueAccess({ userId: 'u1', sessionId: 's1', scope: 'full' });
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
  });

  it('carries a unique jti per token, so two issues are distinguishable', () => {
    const svc = service();
    const a = svc.issueAccess({ userId: 'u1', sessionId: 's1', scope: 'full' }).accessToken;
    const b = svc.issueAccess({ userId: 'u1', sessionId: 's1', scope: 'full' }).accessToken;
    expect(a).not.toBe(b);
  });

  it('preserves the step-up scope', () => {
    const svc = service();
    const token = svc.issueAccess({ userId: 'u1', sessionId: 's1', scope: 'pwd_change' }).accessToken;
    expect(svc.verifyAccess(token)?.scope).toBe('pwd_change');
  });
});

describe('verifyAccess returns null on every problem, never a distinguishable error', () => {
  // A caller able to tell 'expired' from 'bad signature' from 'wrong audience'
  // learns exactly what an attacker probing a forged token wants to know.
  it.each([
    [undefined, 'undefined'],
    [null, 'null'],
    ['', 'empty'],
    ['not.a.jwt', 'not a JWT'],
    ['a.b.c', 'three junk segments'],
  ])('refuses %p (%s)', (token: string | null | undefined, _label: string) => {
    expect(service().verifyAccess(token)).toBeNull();
  });

  it('refuses a token signed with another secret', () => {
    const other = service({ jwtSecret: 'a-different-secret-entirely' });
    const token = other.issueAccess({ userId: 'u1', sessionId: 's1', scope: 'full' }).accessToken;
    expect(service().verifyAccess(token)).toBeNull();
  });

  it('refuses a token from another issuer', () => {
    const other = service({ issuer: 'someone-else' });
    const token = other.issueAccess({ userId: 'u1', sessionId: 's1', scope: 'full' }).accessToken;
    expect(service().verifyAccess(token)).toBeNull();
  });

  it('refuses a token for another audience', () => {
    // Two services sharing a secret but not an audience must not accept each
    // other's tokens. That is what the audience is for.
    const other = service({ audience: 'some-other-api' });
    const token = other.issueAccess({ userId: 'u1', sessionId: 's1', scope: 'full' }).accessToken;
    expect(service().verifyAccess(token)).toBeNull();
  });

  it('refuses an expired token', () => {
    const svc = service({ accessTokenTtl: -1 });
    const token = svc.issueAccess({ userId: 'u1', sessionId: 's1', scope: 'full' }).accessToken;
    expect(service().verifyAccess(token)).toBeNull();
  });

  it('refuses alg:none — the classic JWT forgery', () => {
    // Without an explicit `algorithms`, the library reads the algorithm from
    // the token's own header, which is attacker-controlled.
    const forged = jwt.sign({ sub: 'u1', sid: 's1', scope: 'full', typ: 'user' }, '', {
      algorithm: 'none',
      issuer: OPTIONS.issuer,
      audience: OPTIONS.audience,
    });
    expect(service().verifyAccess(forged)).toBeNull();
  });

  it('refuses a well-signed token with claims missing', () => {
    const forged = jwt.sign({ sub: 'u1', typ: 'user' }, OPTIONS.jwtSecret, {
      algorithm: 'HS256',
      issuer: OPTIONS.issuer,
      audience: OPTIONS.audience,
    });
    expect(service().verifyAccess(forged)).toBeNull();
  });

  it('refuses an unknown scope, so a new scope cannot be invented by a caller', () => {
    const forged = jwt.sign(
      { sub: 'u1', sid: 's1', scope: 'superuser', typ: 'user', exp: 9_999_999_999 },
      OPTIONS.jwtSecret,
      {
        algorithm: 'HS256',
        issuer: OPTIONS.issuer,
        audience: OPTIONS.audience,
      },
    );
    expect(service().verifyAccess(forged)).toBeNull();
  });

  it('refuses a token of another type', () => {
    const forged = jwt.sign(
      { sub: 'u1', sid: 's1', scope: 'full', typ: 'service', exp: 9_999_999_999 },
      OPTIONS.jwtSecret,
      {
        algorithm: 'HS256',
        issuer: OPTIONS.issuer,
        audience: OPTIONS.audience,
      },
    );
    expect(service().verifyAccess(forged)).toBeNull();
  });
});

describe('opaque tokens', () => {
  it('issues a token, its hash, and an expiry — and never the token twice', () => {
    const issued = service().issueRefresh();
    expect(issued.token).toMatch(/^[\w-]{43}$/); // 32 bytes, base64url
    expect(issued.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('is not a JWT — nothing should be able to read anything out of it', () => {
    expect(service().issueRefresh().token).not.toContain('.');
  });

  it('is unpredictable', () => {
    const svc = service();
    const tokens = new Set(Array.from({ length: 50 }, () => svc.issueRefresh().token));
    expect(tokens.size).toBe(50);
  });

  it('hashes deterministically, so a presented token finds its row', () => {
    const svc = service();
    const { token, tokenHash } = svc.issueRefresh();
    expect(svc.hashOpaque(token)).toBe(tokenHash);
  });

  it('honours a shorter TTL for reset links, which wait in an inbox', () => {
    const short = service().issueOpaque(60);
    const long = service().issueRefresh();
    expect(short.expiresAt.getTime()).toBeLessThan(long.expiresAt.getTime());
  });
});

describe('TokenService.bearer', () => {
  it.each([
    ['Bearer abc.def', 'abc.def'],
    ['bearer abc.def', 'abc.def'],
    ['BEARER   abc.def  ', 'abc.def'],
  ])('reads %p case-insensitively', (header, expected) => {
    expect(TokenService.bearer(header)).toBe(expected);
  });

  it.each([[undefined], [null], [''], ['abc.def'], ['Basic dXNlcjpwYXNz'], [42]])('returns null for %p', (header) => {
    expect(TokenService.bearer(header)).toBeNull();
  });
});

describe('the mfa scope is reserved but grants nothing', () => {
  it('round-trips, so a half-admitted session is representable', () => {
    // Reserved before 2FA is built: adding the value later would mean every
    // already-issued token was minted by a verifier that did not know it existed.
    const svc = service();
    const token = svc.issueAccess({ userId: 'u1', sessionId: 's1', scope: 'mfa' }).accessToken;
    expect(svc.verifyAccess(token)?.scope).toBe('mfa');
  });

  it('is still refused by resolvePrincipal — see apps/web-server', () => {
    // Verification says "this token is genuine", not "this token is enough".
    // The app admits `full` and nothing else, so a new scope grants no
    // permissions anywhere by default.
    expect(
      service().verifyAccess(service().issueAccess({ userId: 'u1', sessionId: 's1', scope: 'mfa' }).accessToken),
    ).not.toBeNull();
  });
});
