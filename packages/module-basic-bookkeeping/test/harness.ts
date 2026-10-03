import type { BooksFeatureKey } from '../src/feature-keys.js';
import { BooksEventPublisher } from '../src/server/books.events.js';
import type { BooksEvent, BooksPubSub } from '../src/server/books.pubsub.js';
import { BooksAccessService } from '../src/server/books-access.service.js';
import { BooksDirectoryService } from '../src/server/books-directory.service.js';
import { BooksEntryService } from '../src/server/books-entry.service.js';
import { BooksInvestorService } from '../src/server/books-investor.service.js';
import { BooksLedgerService } from '../src/server/books-ledger.service.js';
import { BooksPosService } from '../src/server/books-pos.service.js';
import { BooksTimeZoneService } from '../src/server/books-time-zone.service.js';
import { BooksResolver } from '../src/server/graphql/books.resolver.js';
import { BooksInvestorResolver } from '../src/server/graphql/books-investor.resolver.js';
import type { BooksAccessCheck, BooksSalesFigures, BooksSalesSource } from '../src/server/ports.js';
import { type FakeClient, fakeClient } from './fake-client.js';

/** Shared set-up for the service suites. */

export const SCOPE = { organizationId: 'org-1', workspaceId: 'ws-1' };
export const OTHER = { organizationId: 'org-2', workspaceId: 'ws-2' };
export const ANA = 'user-ana';
export const BEN = 'user-ben';

/** 10:00 in Manila on 3 Oct 2026 — 02:00Z, the same day in UTC. */
export const NOW = new Date('2026-10-03T02:00:00Z');

/** A recording engine: every publish kept, nobody listening. */
export function recordingPubSub(): BooksPubSub & { sent: BooksEvent[] } {
  const engine = {
    sent: [] as BooksEvent[],
    async publish(_trigger: string, payload: unknown) {
      engine.sent.push(payload as BooksEvent);
    },
    async *asyncIterableIterator<T>(): AsyncIterableIterator<T> {
      // Nothing streams in these suites.
    },
  };
  return engine;
}

/** A point of sale that answers the same figures for any days, and remembers what it was asked. */
export function fixedSales(figures: Partial<BooksSalesFigures> = {}): BooksSalesSource & { asked: string[][] } {
  const source = {
    asked: [] as string[][],
    async salesBetween(_org: string, _ws: string, fromDay: string, toDay: string): Promise<BooksSalesFigures> {
      source.asked.push([fromDay, toDay]);
      return {
        cash: 0,
        ewallet: 0,
        bank: 0,
        costOfGoods: 0,
        costCoverage: 10_000,
        orders: 0,
        truncated: false,
        ...figures,
      };
    },
  };
  return source;
}

export interface HarnessOptions {
  /** The workspace's zone. Omitted: the port is UNBOUND (Asia/Manila). */
  timeZone?: string;
  /** Who holds which key beyond what the guard checked. Omitted: the access port is UNBOUND. */
  holders?: Partial<Record<BooksFeatureKey, readonly string[]>>;
  /** The point of sale. Omitted: UNBOUND — there is none. */
  sales?: BooksSalesSource;
}

export function harness(options: HarnessOptions = {}) {
  const prisma: FakeClient = fakeClient();
  const pubsub = recordingPubSub();
  const events = new BooksEventPublisher(pubsub);
  const accessPort: BooksAccessCheck | undefined = options.holders
    ? { holds: async (_org, _ws, userId, key) => (options.holders?.[key] ?? []).includes(userId) }
    : undefined;
  const access = new BooksAccessService(accessPort);
  const zones = new BooksTimeZoneService(
    options.timeZone === undefined ? undefined : { timeZoneOf: async () => options.timeZone ?? null },
  );
  const directory = new BooksDirectoryService({
    describe: async (ids) => ids.map((userId) => ({ userId, displayName: userId.replace('user-', '') })),
  });
  const ledger = new BooksLedgerService(prisma, zones, directory, options.sales);
  const entries = new BooksEntryService(prisma, events, zones, access);
  const investors = new BooksInvestorService(prisma, events, zones);
  const pos = new BooksPosService(prisma, events, zones, options.sales);
  const moduleOptions = { resolveActorId: (request: unknown) => (request as { userId?: string } | undefined)?.userId };
  const resolver = new BooksResolver(ledger, entries, pos, moduleOptions, pubsub);
  const investorResolver = new BooksInvestorResolver(investors, entries, moduleOptions);
  return { prisma, pubsub, events, access, zones, ledger, entries, investors, pos, resolver, investorResolver };
}

export type Harness = ReturnType<typeof harness>;

let next = 0;

/** A fresh client id, as a form makes one. */
export function cid(): string {
  next += 1;
  return `client-${next}`;
}

/** Records the day's money with sensible defaults. */
export function record(
  h: Harness,
  input: {
    kind: string;
    amount: number;
    day?: string;
    place?: string;
    category?: string;
    loanId?: string;
    toPlace?: string;
  },
  actor = ANA,
) {
  return h.entries.record(
    SCOPE,
    actor,
    {
      kind: input.kind,
      amount: input.amount,
      place: input.place ?? 'cash',
      toPlace: input.toPlace ?? null,
      day: input.day ?? '2026-10-01',
      category: input.category ?? (input.kind === 'expense' ? 'Rent' : null),
      loanId: input.loanId ?? null,
      clientId: cid(),
    },
    NOW,
  );
}

/** Records an investor's money with sensible defaults. */
export function invest(
  h: Harness,
  input: { kind: string; investorId: string; amount: number; day?: string; place?: string | null; advance?: boolean },
  actor = ANA,
) {
  return h.entries.recordInvestor(
    SCOPE,
    actor,
    {
      kind: input.kind,
      investorId: input.investorId,
      amount: input.amount,
      place: input.place === undefined ? 'cash' : input.place,
      day: input.day ?? '2026-09-01',
      advance: input.advance ?? false,
      clientId: cid(),
    },
    NOW,
  );
}

/** Adds an investor. */
export async function addInvestor(h: Harness, name: string, agreedShare: number | null = null) {
  return h.investors.save(SCOPE, ANA, { name, agreedShare });
}

/** Expects `promise` to be refused with `reason`. */
export async function refusedWith(promise: Promise<unknown>, reason: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ reason });
}
