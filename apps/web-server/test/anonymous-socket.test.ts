import type { AddressInfo } from 'node:net';
import type { Principal } from '@kwtech/module-auth';
import { AUTH_OPTIONS, JwtAuthGuard, TokenService } from '@kwtech/module-auth/server';
import { anonymousAdmission, PUBLIC_SURFACE_METADATA } from '@kwtech/module-kit';
import type { ApolloDriverConfig } from '@nestjs/apollo';
import { type INestApplication, SetMetadata } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Context, GraphQLModule, Query, Resolver, Subscription } from '@nestjs/graphql';
import { Test } from '@nestjs/testing';
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';

/**
 * ⚠ AN ANONYMOUS SOCKET REACHES WHAT IS PUBLIC, AND NOTHING ELSE — over a real
 * socket, through the real handshake and the real `JwtAuthGuard`.
 *
 * Proven BEFORE any queue code exists, with a stand-in public subscription, so
 * the security property is tested on its own (PLAN, `module-queuing-window`
 * build order, step 2). ./ws-context.test.ts covers the branch as a function;
 * this covers the WIRING, which is where this handshake has failed before —
 * Nest passing the top-level `context` to `useServer`, and `onConnect`'s return
 * value going to the client — and neither failure was visible to a unit test.
 */

/*
 * `graphql.options.ts` reads the app's validated environment when imported,
 * and that refuses to load without these. Neither is used: nothing here opens
 * a database, and no token is signed with the app's secret. `||=` so a
 * developer's own `.env` wins, which changes nothing either.
 */
process.env.DATABASE_URL ||= 'postgresql://unused/anonymous-socket-test';
process.env.AUTH_JWT_SECRET ||= 'anonymous-socket-test-secret-never-used-to-sign';

/** Shaped like a display pass: 256 random bits, base64url. */
const PASS = 'p'.repeat(43);
const TICKET = 'a-ticket-the-stub-verifier-accepts';

const PRINCIPAL: Principal = {
  userId: 'u1',
  sessionId: 's1',
  scope: 'full',
  expiresAt: Math.floor(Date.now() / 1000) + 900,
  issuedAt: Math.floor(Date.now() / 1000),
};

async function* once<T>(value: T): AsyncGenerator<T> {
  yield value;
}

@Resolver()
class ProbeResolver {
  // A schema needs a Query root. Nothing here asks for it.
  @Query(() => String)
  probe(): string {
    return 'ok';
  }

  @SetMetadata(PUBLIC_SURFACE_METADATA, 'the anonymous-handshake test: a stand-in public board')
  @Subscription(() => String)
  publicBoard(@Context('req') req: unknown): AsyncGenerator<{ publicBoard: string }> {
    const admission = anonymousAdmission<{ sessionId: string }>(req);
    return once({ publicBoard: admission ? `admitted for ${admission.sessionId}` : 'no admission' });
  }

  @Subscription(() => String)
  privateFeed(): AsyncGenerator<{ privateFeed: string }> {
    return once({ privateFeed: 'for somebody signed in' });
  }
}

const lifecycle = { opened: jest.fn(), closed: jest.fn(), alive: jest.fn() };
const admit = jest.fn(async (params: Readonly<Record<string, unknown>>) =>
  params.displayPass === PASS ? { sessionId: 'session-1' } : null,
);

let app: INestApplication;
let url: string;

beforeAll(async () => {
  // Imported here, after the environment above is in place.
  const { GRAPHQL_DRIVER, graphqlOptions, requestFromContext } = await import('../src/graphql/graphql.options.js');

  const authOptions = {
    jwtSecret: 'anonymous-socket-test-secret-anonymous-socket-test',
    issuer: 'anonymous-socket-test',
    audience: 'anonymous-socket-test',
    mfaIssuerLabel: 'anonymous-socket-test',
    getRequest: requestFromContext,
  };
  const verifier = { verifyWsTicket: (ticket: string | undefined | null) => (ticket === TICKET ? PRINCIPAL : null) };

  const moduleRef = await Test.createTestingModule({
    imports: [
      GraphQLModule.forRootAsync<ApolloDriverConfig>({
        driver: GRAPHQL_DRIVER,
        useFactory: () => ({
          ...graphqlOptions(verifier, lifecycle, admit),
          // In memory. The real options WRITE schema.graphql, and this schema is a probe.
          autoSchemaFile: true,
        }),
      }),
    ],
    providers: [
      ProbeResolver,
      { provide: AUTH_OPTIONS, useValue: authOptions },
      { provide: TokenService, useValue: new TokenService(authOptions) },
      JwtAuthGuard,
      { provide: APP_GUARD, useExisting: JwtAuthGuard },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  url = `ws://127.0.0.1:${port}/api/v1/graphql`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

interface Outcome {
  data?: unknown;
  errors?: readonly { message: string }[];
  closeCode?: number;
}

/** Opens a socket, runs one subscription to its end, and reports what came back. */
function subscribeOnce(connectionParams: Record<string, unknown>, query: string): Promise<Outcome> {
  return new Promise((resolve) => {
    const outcome: Outcome = {};
    const client = createClient({ url, webSocketImpl: WebSocket, connectionParams, retryAttempts: 0 });
    const finish = () => {
      void client.dispose();
      resolve(outcome);
    };

    client.subscribe(
      { query },
      {
        next: (result) => Object.assign(outcome, result),
        error: (error) => {
          // An array is GraphQL errors; anything else is the socket closing.
          if (Array.isArray(error)) outcome.errors = error;
          else outcome.closeCode = (error as { code?: number }).code;
          finish();
        },
        complete: finish,
      },
    );
  });
}

/** Lets the server run `onDisconnect` for a socket the client just closed. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

describe('a socket admitted without a session', () => {
  it('reaches a public subscription, whose resolver can read what admitted it', async () => {
    const outcome = await subscribeOnce({ displayPass: PASS }, 'subscription { publicBoard }');

    expect(outcome.errors).toBeUndefined();
    expect(outcome.data).toEqual({ publicBoard: 'admitted for session-1' });
    expect(admit).toHaveBeenCalledWith({ displayPass: PASS });
  });

  /**
   * ⚠ THE PROPERTY. Nothing new enforces it: the socket carries no principal,
   * and `JwtAuthGuard` refuses a non-public operation that has none.
   */
  it('is refused "Not signed in" by a subscription that is not public', async () => {
    const outcome = await subscribeOnce({ displayPass: PASS }, 'subscription { privateFeed }');

    expect(outcome.data ?? null).toBeNull();
    expect(outcome.errors?.map((error) => error.message)).toEqual(['Not signed in']);
  });

  it('is closed as 4403 when the module refuses its credential, before any operation runs', async () => {
    const outcome = await subscribeOnce({ displayPass: 'guessed' }, 'subscription { publicBoard }');

    expect(outcome.closeCode).toBe(4403);
    expect(outcome.data).toBeUndefined();
  });

  it('is never announced to presence, opening or closing', async () => {
    await subscribeOnce({ displayPass: PASS }, 'subscription { publicBoard }');
    await settle();

    expect(lifecycle.opened).not.toHaveBeenCalled();
    expect(lifecycle.closed).not.toHaveBeenCalled();
    expect(lifecycle.alive).not.toHaveBeenCalled();
  });
});

describe('a ticketed socket, beside the anonymous branch', () => {
  it('still reaches what needs a signed-in user, and is announced to presence', async () => {
    const outcome = await subscribeOnce({ ticket: TICKET }, 'subscription { privateFeed }');
    await settle();

    expect(outcome.data).toEqual({ privateFeed: 'for somebody signed in' });
    expect(lifecycle.opened).toHaveBeenCalledWith('u1', expect.any(String));
    expect(lifecycle.closed).toHaveBeenCalledWith('u1', expect.any(String));
    expect(admit).not.toHaveBeenCalled();
  });
});
