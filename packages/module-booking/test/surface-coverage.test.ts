import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_SURFACE_METADATA, PUBLIC_SURFACE_METADATA, REQUIRED_SCOPE_METADATA } from '@kwtech/module-kit';
import { BOOKING_FEATURE, BOOKING_FEATURE_REGISTRY } from '../src/feature-keys.js';
import { BOOKING_OPERATIONS } from '../src/operations.js';
import { BookingResolver } from '../src/server/graphql/booking.resolver.js';
import { BookingPublicResolver } from '../src/server/graphql/booking-public.resolver.js';

/**
 * ⚠ THE §12.13 TRAP, TURNED INTO A RED BUILD — `module-task`'s suite, for
 * booking.
 *
 * Every `booking:*` key is workspace level. A resolver with no declared scope
 * resolves at app level, where no workspace key participates, and every key
 * grants nothing to everybody — with no error. And there is no
 * `@RequireFeature` here, so a missing BINDING is an unguarded operation.
 */

function publishedOperations(): string[] {
  const source = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', 'booking.resolver.ts'), 'utf8');
  return [...source.matchAll(/@(Query|Mutation|Subscription)\([\s\S]*?name:\s*'([^']+)'/g)].map(
    (match) => `${match[1]}.${match[2]}`,
  );
}

const OPERATIONS = publishedOperations();

const BOUND = new Map<string, string>();
for (const spec of BOOKING_FEATURE_REGISTRY) {
  for (const binding of spec.bindings ?? []) {
    if (binding.surface === 'graphql_operation' || binding.surface === 'graphql_subscription') {
      BOUND.set(binding.identifier, spec.key);
    }
  }
}

function handlers(): Array<[string, object]> {
  const prototype = BookingResolver.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .map((name) => [name, prototype[name] as object]);
}

describe('the booking resolver', () => {
  it('publishes operations — the reflection has to work for this suite to mean anything', () => {
    expect(OPERATIONS.length).toBe(25);
  });

  it('⚠ declares WORKSPACE scope on the class, so no operation can forget it', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, BookingResolver)).toEqual({ level: 'workspace' });
  });

  it('⚠ marks nothing public, and nothing a credential surface — the customer’s page is another class', () => {
    for (const [name, handler] of handlers()) {
      expect([name, Reflect.getMetadata(PUBLIC_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
      expect([name, Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, handler)]).toEqual([name, undefined]);
    }
  });

  it.each(OPERATIONS)('⚠ %s is bound to a key', (identifier) => {
    expect(BOUND.get(identifier)).toBeDefined();
  });

  it('binds every read to booking:read, except the member list', () => {
    const elsewhere: Record<string, string> = { 'Query.bookingMembers': BOOKING_FEATURE.manageServices };
    for (const [identifier, key] of BOUND) {
      if (!identifier.startsWith('Query.') && !identifier.startsWith('Subscription.')) continue;
      expect([identifier, key]).toEqual([identifier, elsewhere[identifier] ?? BOOKING_FEATURE.read]);
    }
  });

  it('⚠ binds cancelling to its own key, and nothing else to it', () => {
    const cancelling = [...BOUND].filter(([, key]) => key === BOOKING_FEATURE.cancelAppointments);
    expect(cancelling.map(([identifier]) => identifier)).toEqual(['Mutation.cancelBookingAppointment']);
  });

  it('binds every other write to a booking to booking:manage_appointments', () => {
    for (const [identifier, key] of BOUND) {
      if (!/^Mutation\.\w+BookingAppointment\w*$/.test(identifier)) continue;
      if (identifier === 'Mutation.cancelBookingAppointment') continue;
      expect([identifier, key]).toEqual([identifier, BOOKING_FEATURE.manageAppointments]);
    }
  });

  it('binds what can be booked to booking:manage_services, and the rules to booking:manage_settings', () => {
    for (const [identifier, key] of BOUND) {
      if (/^Mutation\.\w+Booking(Service|Resource|Exception)\w*$/.test(identifier)) {
        expect([identifier, key]).toEqual([identifier, BOOKING_FEATURE.manageServices]);
      }
    }
    expect(BOUND.get('Mutation.saveBookingSettings')).toBe(BOOKING_FEATURE.manageSettings);
  });
});

describe('the bindings', () => {
  it('⚠ name no operation that is not published', () => {
    expect([...BOUND.keys()].filter((identifier) => !OPERATIONS.includes(identifier))).toEqual([]);
  });

  it('bind the subscription as a subscription surface', () => {
    const surfaces = BOOKING_FEATURE_REGISTRY.flatMap((spec) => spec.bindings ?? []).filter((binding) =>
      binding.identifier.startsWith('Subscription.'),
    );
    expect(surfaces).toEqual([{ surface: 'graphql_subscription', identifier: 'Subscription.bookingEvents' }]);
  });
});

/**
 * The customer's surface. Every operation here is reached with no session, so
 * every one must SAY so — and none may be bound to a key, because nobody
 * holding a key is asking.
 */
function publicOperations(): Array<{ identifier: string; method: string }> {
  const source = readFileSync(join(__dirname, '..', 'src', 'server', 'graphql', 'booking-public.resolver.ts'), 'utf8');
  return [
    ...source.matchAll(/@(Query|Mutation|Subscription)\([\s\S]*?name:\s*'([^']+)'[\s\S]*?\)\s*async (\w+)\(/g),
  ].map((match) => ({ identifier: `${match[1]}.${match[2]}`, method: match[3] ?? '' }));
}

const PUBLIC_OPERATIONS = publicOperations();

/** The operations that take a manage token — a secret somebody could be guessing. */
const BY_TOKEN = [
  'Query.publicBooking',
  'Query.publicBookingMoveSlots',
  'Mutation.cancelPublicBooking',
  'Mutation.reschedulePublicBooking',
];

describe('the public booking resolver', () => {
  const prototype = BookingPublicResolver.prototype as unknown as Record<string, object>;

  it('publishes the customer’s seven operations', () => {
    expect(PUBLIC_OPERATIONS.map((operation) => operation.identifier).sort()).toEqual(
      ['Query.publicBookingPage', 'Query.publicBookingSlots', 'Mutation.requestPublicBooking', ...BY_TOKEN].sort(),
    );
  });

  it('⚠ declares NO workspace scope: a customer belongs to no workspace', () => {
    expect(Reflect.getMetadata(REQUIRED_SCOPE_METADATA, BookingPublicResolver)).toBeUndefined();
  });

  it.each(PUBLIC_OPERATIONS)('⚠ $identifier is marked public, with a reason', ({ method }) => {
    const reason = Reflect.getMetadata(PUBLIC_SURFACE_METADATA, prototype[method] ?? {});
    expect(typeof reason === 'string' && reason.trim().length > 0).toBe(true);
  });

  it.each(PUBLIC_OPERATIONS)(
    '⚠ $identifier is a credential surface exactly when it takes the manage token',
    (operation) => {
      const marked = Reflect.getMetadata(CREDENTIAL_SURFACE_METADATA, prototype[operation.method] ?? {});
      expect([operation.identifier, typeof marked === 'string' && marked.length > 0]).toEqual([
        operation.identifier,
        BY_TOKEN.includes(operation.identifier),
      ]);
    },
  );

  it('⚠ is bound to no key — deliberately: the link id or the manage token is the authority', () => {
    expect(PUBLIC_OPERATIONS.filter((operation) => BOUND.has(operation.identifier))).toEqual([]);
  });

  it('⚠ takes no organization or workspace from the visitor', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'server', 'graphql', 'booking-public.resolver.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/@Args\('(organizationId|workspaceId)'\)/u);
  });
});

describe('the documents the client sends', () => {
  it('cover exactly the published operations', () => {
    const fields = Object.values(BOOKING_OPERATIONS).map((document) => {
      const match = /^\s*(query|mutation|subscription)\s+\w+[^{]*\{\s*(\w+)/.exec(document);
      const kind = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }[match?.[1] ?? 'query'];
      return `${kind}.${match?.[2]}`;
    });
    const published = [...OPERATIONS, ...PUBLIC_OPERATIONS.map((operation) => operation.identifier)];
    expect(fields.sort()).toEqual(published.sort());
  });
});
