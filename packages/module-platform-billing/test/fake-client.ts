import { platformDayStart } from '../src/domain/days.js';
import type {
  BillRow,
  CounterRow,
  CreditRow,
  EventRow,
  PaymentRow,
  PlatformBillingTransaction,
  PlatformBillingWriteClient,
  PriceRowStored,
  ReceiptRow,
  RequestRow,
  SettingsRow,
} from '../src/server/platform-billing.repository.js';
import { PlatformBillingService } from '../src/server/platform-billing.service.js';
import { PlatformBillingWriteService } from '../src/server/platform-billing-write.service.js';
import type {
  BillingPlan,
  BillingSubscriptionRow,
  PlatformBillingPeople,
  PlatformBillingPlans,
  PlatformBillingSubscriptions,
} from '../src/server/ports.js';

/**
 * An in-memory billing database, and the subscription it writes, with
 * transactions that ROLL BACK: each `$transaction` runs alone (one at a time,
 * as a row lock would order two approvals) on a copy, and the copy replaces the
 * store only when the work returns. A throw leaves the store — counters
 * included — exactly as it was, which is what "no gap in the numbering" and
 * "one receipt" are tested against.
 */

interface Store {
  requests: RequestRow[];
  payments: PaymentRow[];
  bills: BillRow[];
  receipts: ReceiptRow[];
  credits: CreditRow[];
  prices: PriceRowStored[];
  settings: SettingsRow | null;
  counters: CounterRow[];
  events: EventRow[];
  /** How many times each organization's decision lock was taken. */
  locks: Record<string, number>;
  /** The organization's live subscription, as permissions would hold it. */
  subscriptions: Map<string, BillingSubscriptionRow>;
  /** Every subscription write, in order: what an approval applied. */
  subscriptionWrites: Array<{ how: string; organizationId: string; planKey?: string; accessUntil: Date }>;
}

/** A database with nothing in it. */
function emptyStore(): Store {
  return {
    requests: [],
    payments: [],
    bills: [],
    receipts: [],
    credits: [],
    prices: [],
    settings: null,
    counters: [],
    events: [],
    locks: {},
    subscriptions: new Map(),
    subscriptionWrites: [],
  };
}

/** A deep copy of the store: what a transaction works on until it commits. */
function clone(store: Store): Store {
  return {
    ...structuredClone({ ...store, subscriptions: [...store.subscriptions.entries()] }),
    subscriptions: new Map(structuredClone([...store.subscriptions.entries()])),
  } as Store;
}

let ids = 0;
/** A unique id for a fake row. */
function id(prefix: string): string {
  ids += 1;
  return `${prefix}${ids}`;
}

/** The error Prisma throws on a `@@unique` violation (P2002). */
function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

/** Whether `value` is a Date, across realms. */
function isDate(value: unknown): value is Date {
  return Object.prototype.toString.call(value) === '[object Date]';
}

/** Whether `row` matches a `where` of equalities, `in` and `not`; nothing else is supported. */
function matches<T extends object>(row: T, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    const value = (row as Record<string, unknown>)[key];
    if (wanted === undefined) return true;
    // By time, not `instanceof`: `structuredClone` under jest makes Dates of another realm.
    if (isDate(wanted)) return isDate(value) && value.getTime() === wanted.getTime();
    if (typeof wanted === 'object' && wanted !== null) {
      if ('in' in wanted) return (wanted as { in: unknown[] }).in.includes(value);
      if ('not' in wanted) return value !== (wanted as { not: unknown }).not;
    }
    return value === wanted;
  });
}

/** The delegates over `store`. */
function delegates(get: () => Store): PlatformBillingTransaction {
  return {
    platformBillingRequest: {
      async findFirst({ where, orderBy }) {
        const rows = get().requests.filter((row) => matches(row, where));
        if (orderBy && 'requestedAt' in orderBy && orderBy.requestedAt === 'desc') rows.reverse();
        if (orderBy && 'decidedAt' in orderBy) {
          const at = (row: RequestRow) => row.decidedAt?.getTime() ?? 0;
          rows.sort((a, b) => (orderBy.decidedAt === 'desc' ? at(b) - at(a) : at(a) - at(b)));
        }
        return rows[0] ? { ...rows[0] } : null;
      },
      async findMany({ where, orderBy, take, cursor }) {
        let rows = get().requests.filter((row) => matches(row, where));
        const desc = orderBy.some((one) => 'requestedAt' in one && one.requestedAt === 'desc');
        rows.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime() || a.id.localeCompare(b.id));
        if (desc) rows.reverse();
        if (cursor) rows = rows.slice(rows.findIndex((row) => row.id === cursor.id) + 1);
        return rows.slice(0, take).map((row) => ({ ...row }));
      },
      async create({ data }) {
        const store = get();
        // Unique as Postgres is: NULLs never collide, so decided requests coexist.
        const slot = data.pendingOrganizationId;
        if (slot !== null && store.requests.some((row) => row.pendingOrganizationId === slot)) throw uniqueViolation();
        const row: RequestRow = {
          id: id('req'),
          state: 'pending',
          detailsVersion: 0,
          coveredOn: null,
          holdDays: 0,
          holdReason: null,
          accessUntilBeforeHold: null,
          decidedById: null,
          decidedAt: null,
          decisionReason: null,
          selfApproved: false,
          approverIsMember: false,
          periodStart: null,
          periodEnd: null,
          billingDay: null,
          accessUntil: null,
          subscriptionId: null,
          applied: null,
          subscriptionBefore: null,
          restoredSubscriptionId: null,
          voidedById: null,
          voidedAt: null,
          voidReason: null,
          updatedAt: data.requestedAt,
          ...data,
        };
        store.requests.push(row);
        return { ...row };
      },
      async updateMany({ where, data }) {
        const rows = get().requests.filter((row) => matches(row, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
      async update({ where, data }) {
        const row = get().requests.find((one) => one.id === where.id);
        if (!row) throw new Error('No such request');
        Object.assign(row, data);
        return { ...row };
      },
    },
    platformBillingPayment: {
      async findFirst({ where }) {
        const rows = get()
          .payments.filter((row) => matches(row, where))
          .sort((a, b) => b.version - a.version);
        return rows[0] ? { ...rows[0] } : null;
      },
      async findMany({ where }) {
        return get()
          .payments.filter((row) => matches(row, where))
          .sort((a, b) => a.version - b.version)
          .map((row) => ({ ...row }));
      },
      async create({ data }) {
        const store = get();
        if (store.payments.some((row) => row.requestId === data.requestId && row.version === data.version)) {
          throw uniqueViolation();
        }
        const row: PaymentRow = { id: id('pay'), ...data };
        store.payments.push(row);
        return { ...row };
      },
    },
    platformBillingBill: {
      async findFirst({ where, orderBy }) {
        const rows = get().bills.filter((row) => matches(row, where));
        rows.sort((a, b) => (orderBy?.number === 'desc' ? b.number - a.number : a.number - b.number));
        return rows[0] ? structuredClone(rows[0]) : null;
      },
      async findMany({ where }) {
        return get()
          .bills.filter((row) => matches(row, where))
          .sort((a, b) => a.number - b.number)
          .map((row) => structuredClone(row));
      },
      async count() {
        return get().bills.length;
      },
      async create({ data }) {
        const store = get();
        if (store.bills.some((row) => row.number === data.number)) throw uniqueViolation();
        const row: BillRow = {
          id: id('bill'),
          cancelledAt: null,
          cancelledReason: null,
          ...data,
          snapshot: structuredClone(data.snapshot),
        };
        store.bills.push(row);
        return structuredClone(row);
      },
      async update({ where, data }) {
        const row = get().bills.find((one) => one.id === where.id);
        if (!row) throw new Error('No such bill');
        Object.assign(row, data);
        return structuredClone(row);
      },
    },
    platformBillingReceipt: {
      async findMany({ where }) {
        return get()
          .receipts.filter((row) => matches(row, where))
          .map((row) => structuredClone(row));
      },
      async findFirst({ where, orderBy }) {
        const rows = get()
          .receipts.filter((row) => matches(row, where))
          .sort((a, b) => (orderBy.number === 'desc' ? b.number - a.number : a.number - b.number));
        return rows[0] ? structuredClone(rows[0]) : null;
      },
      async update({ where, data }) {
        const row = get().receipts.find((one) => one.id === where.id);
        if (!row) throw new Error('No such receipt');
        Object.assign(row, data);
        return structuredClone(row);
      },
      async create({ data }) {
        const store = get();
        if (store.receipts.some((row) => row.number === data.number)) throw uniqueViolation();
        const row: ReceiptRow = {
          id: id('rcp'),
          voidedAt: null,
          voidedById: null,
          voidReason: null,
          ...data,
          snapshot: structuredClone(data.snapshot),
        };
        store.receipts.push(row);
        return structuredClone(row);
      },
    },
    platformBillingCredit: {
      async aggregate({ where }) {
        const rows = get().credits.filter((row) => row.organizationId === where.organizationId);
        return { _sum: { amount: rows.length ? rows.reduce((sum, row) => sum + row.amount, 0) : null } };
      },
      async findMany({ where }) {
        return get()
          .credits.filter((row) => matches(row, where))
          .map((row) => ({ ...row }));
      },
      async create({ data }) {
        const row: CreditRow = { id: id('cr'), subscriptionId: null, ...data };
        get().credits.push(row);
        return { ...row };
      },
    },
    platformBillingPrice: {
      async findMany() {
        return get().prices.map((row) => ({ ...row }));
      },
      async upsert({ where, create, update }) {
        const store = get();
        const key = where.planKey_effectiveFrom;
        const found = store.prices.find(
          (row) => row.planKey === key.planKey && row.effectiveFrom.getTime() === key.effectiveFrom.getTime(),
        );
        if (found) {
          Object.assign(found, update);
          return { ...found };
        }
        const row: PriceRowStored = { id: id('price'), createdAt: new Date(), ...create };
        store.prices.push(row);
        return { ...row };
      },
    },
    platformBillingSettings: {
      async findUnique() {
        const row = get().settings;
        return row ? { ...row } : null;
      },
      async upsert({ create, update }) {
        const store = get();
        const base: SettingsRow = store.settings ?? {
          id: create.id,
          currency: 'PHP',
          timeZone: 'Asia/Manila',
          graceDays: 7,
          issuerName: '',
          issuerDetails: '',
          paymentAccounts: [],
          updatedById: null,
          updatedAt: new Date(),
        };
        store.settings = { ...base, ...(store.settings ? update : create) } as SettingsRow;
        return { ...store.settings };
      },
    },
    platformBillingLock: {
      // The fake runs one transaction at a time already; the lock is recorded so a test can see it taken.
      async upsert({ where }) {
        const store = get();
        store.locks[where.organizationId] = (store.locks[where.organizationId] ?? 0) + 1;
        return { organizationId: where.organizationId, version: store.locks[where.organizationId] ?? 0 };
      },
    },
    platformBillingCounter: {
      async upsert({ where, create, update }) {
        const store = get();
        const found = store.counters.find((row) => row.sequence === where.sequence);
        if (found) {
          found.value += update.value.increment;
          return { ...found };
        }
        const row = { ...create };
        store.counters.push(row);
        return { ...row };
      },
    },
    platformBillingEvent: {
      async findMany({ where }) {
        return get()
          .events.filter((row) => matches(row, where))
          .map((row) => structuredClone(row));
      },
      async create({ data }) {
        const row: EventRow = { id: id('ev'), ...data, data: structuredClone(data.data) };
        get().events.push(row);
        return structuredClone(row);
      },
    },
  };
}

/** The fake database, with its subscription port and plans. */
export interface FakeBilling {
  store(): Store;
  client: PlatformBillingWriteClient;
  subscriptions: PlatformBillingSubscriptions;
  plans: PlatformBillingPlans & { list: BillingPlan[]; usageOf: Record<string, number> };
  people: PlatformBillingPeople & { members: Set<string> };
  reads: PlatformBillingService;
  writes: PlatformBillingWriteService;
}

/** Basic 1,000 and Pro 1,500 a month, both public; Free with no price. */
export const PLANS: BillingPlan[] = [
  {
    key: 'free',
    label: 'Free',
    isPublic: true,
    archived: false,
    features: ['note:read'],
    limits: { 'organization:members': 3 },
  },
  {
    key: 'basic',
    label: 'Basic',
    isPublic: true,
    archived: false,
    features: ['note:read', 'task:read'],
    limits: { 'organization:members': 3 },
  },
  {
    key: 'pro',
    label: 'Pro',
    isPublic: true,
    archived: false,
    features: ['note:read', 'task:read', 'pos:read'],
    limits: { 'organization:members': 10 },
  },
];

/** A fresh fake: the client, the ports and both services wired over one store. */
export function fakeBilling(): FakeBilling {
  let store = emptyStore();
  let inFlight: Store | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const current = () => inFlight ?? store;
  const base = delegates(current);

  const client: PlatformBillingWriteClient = {
    ...base,
    $transaction<T>(fn: (tx: PlatformBillingTransaction) => Promise<T>): Promise<T> {
      // One at a time, as the request row's lock orders two approvals in Postgres.
      const run = queue.then(async () => {
        const copy = clone(store);
        inFlight = copy;
        try {
          const result = await fn(delegates(() => copy));
          store = copy;
          return result;
        } finally {
          inFlight = null;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };

  const write = (organizationId: string, change: Partial<BillingSubscriptionRow>, how: string, startNew: boolean) => {
    const target = current();
    const live = target.subscriptions.get(organizationId);
    if (!startNew && !live) {
      throw Object.assign(new Error('This organization has no live subscription to renew or change'), {
        reason: 'not_found',
      });
    }
    const row: BillingSubscriptionRow = startNew
      ? {
          subscriptionId: id('sub'),
          planKey: change.planKey ?? '',
          planArchived: false,
          periodStart: null,
          currentPeriodEnd: null,
          billingDay: null,
          accessUntil: null,
          trial: false,
          ...change,
        }
      : { ...(live as BillingSubscriptionRow), ...change };
    target.subscriptions.set(organizationId, row);
    target.subscriptionWrites.push({
      how,
      organizationId,
      ...(change.planKey ? { planKey: change.planKey } : {}),
      accessUntil: row.accessUntil ?? new Date(0),
    });
    return { subscriptionId: row.subscriptionId };
  };

  const subscriptions: PlatformBillingSubscriptions = {
    async liveOnPlan(planKey) {
      return [...current().subscriptions.entries()]
        .filter(([, row]) => row.planKey === planKey)
        .map(([organizationId, row]) => ({ ...row, organizationId }));
    },
    async live(organizationId) {
      const row = current().subscriptions.get(organizationId);
      return row ? { ...row } : null;
    },
    async renew(input) {
      return write(
        input.organizationId,
        {
          periodStart: input.periodStart,
          currentPeriodEnd: input.periodEnd,
          billingDay: input.billingDay,
          accessUntil: input.accessUntil,
        },
        'renew',
        false,
      );
    },
    async changePlan(input) {
      return write(
        input.organizationId,
        {
          planKey: input.planKey,
          periodStart: input.periodStart,
          currentPeriodEnd: input.periodEnd,
          billingDay: input.billingDay,
          accessUntil: input.accessUntil,
        },
        'change',
        true,
      );
    },
    async start(input) {
      return write(
        input.organizationId,
        {
          planKey: input.planKey,
          periodStart: input.periodStart,
          currentPeriodEnd: input.periodEnd,
          billingDay: input.billingDay,
          accessUntil: input.accessUntil,
        },
        'start',
        true,
      );
    },
    async setAccessUntil(input) {
      return write(input.organizationId, { accessUntil: input.accessUntil }, 'access', false);
    },
    async end(input) {
      const target = current();
      const live = target.subscriptions.get(input.organizationId);
      if (!live) throw new Error('This organization has no live subscription to end');
      // Ended: the organization holds no live row, and permissions falls back to Free.
      target.subscriptions.delete(input.organizationId);
      target.subscriptionWrites.push({ how: 'end', organizationId: input.organizationId, accessUntil: new Date(0) });
      return { subscriptionId: live.subscriptionId };
    },
  };

  const plans = {
    list: structuredClone(PLANS),
    usageOf: {} as Record<string, number>,
    async plans() {
      return plans.list;
    },
    async usage() {
      return plans.usageOf;
    },
  };
  const people = {
    members: new Set<string>(),
    async isMember(userId: string, organizationId: string) {
      return people.members.has(`${userId}@${organizationId}`);
    },
  };

  const reads = new PlatformBillingService(client, subscriptions, plans);
  const writes = new PlatformBillingWriteService(client, reads, subscriptions, people);
  return { store: () => store, client, subscriptions, plans, people, reads, writes };
}

/** Puts `organizationId` on `planKey` for the period `[start, end)`, access to `accessUntil` (days, Manila). */
export function giveSubscription(
  billing: FakeBilling,
  organizationId: string,
  planKey: string,
  start: string,
  end: string,
  accessUntil: string,
  options: { trial?: boolean } = {},
): void {
  billing.store().subscriptions.set(organizationId, {
    subscriptionId: id('sub'),
    planKey,
    planArchived: false,
    periodStart: platformDayStart(start, 'Asia/Manila'),
    currentPeriodEnd: platformDayStart(end, 'Asia/Manila'),
    billingDay: Number(start.slice(8, 10)),
    accessUntil: platformDayStart(accessUntil, 'Asia/Manila'),
    trial: options.trial ?? false,
  });
}

/** Sets prices from a day long past: Basic 1,000.00 and Pro 1,500.00 (centavos). */
export async function setPrices(billing: FakeBilling): Promise<void> {
  await billing.writes.setPrice('admin', 'basic', 100_000, '2026-01-01');
  await billing.writes.setPrice('admin', 'pro', 150_000, '2026-01-01');
}

/** Noon in Manila on `day`: an instant well inside the platform day. */
export function noonOn(day: string): Date {
  return new Date(`${day}T04:00:00.000Z`);
}
