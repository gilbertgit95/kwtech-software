import { platformDayStart } from '../src/domain/days.js';
import type {
  BillRow,
  CounterRow,
  CreditRow,
  EventRow,
  NoticeRow,
  PaymentRow,
  PlatformBillingTransaction,
  PlatformBillingWriteClient,
  PriceRowStored,
  ReceiptRow,
  RequestRow,
  SettingsRow,
} from '../src/server/platform-billing.repository.js';
import { PlatformBillingService } from '../src/server/platform-billing.service.js';
import { PlatformBillingDailyCheck } from '../src/server/platform-billing-daily.process.js';
import { PlatformBillingReportsService } from '../src/server/platform-billing-reports.service.js';
import { PlatformBillingWriteService } from '../src/server/platform-billing-write.service.js';
import type {
  BillingPlan,
  BillingSubscriptionRow,
  PlatformBillingNotifier,
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
  notices: NoticeRow[];
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
    notices: [],
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
function matches<T extends object>(row: T, where: object): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    const value = (row as Record<string, unknown>)[key];
    if (wanted === undefined) return true;
    // By time, not `instanceof`: `structuredClone` under jest makes Dates of another realm.
    if (isDate(wanted)) return isDate(value) && value.getTime() === wanted.getTime();
    if (typeof wanted === 'object' && wanted !== null) {
      // Every operator present must hold, as Prisma ANDs them: `{ gte, lt }` is a range.
      const ops = wanted as Record<string, unknown>;
      const time = (operand: unknown) => (isDate(operand) ? operand.getTime() : Number.NaN);
      const at = isDate(value) ? value.getTime() : Number.NaN;
      const checks: boolean[] = [];
      if ('in' in ops) checks.push((ops.in as unknown[]).includes(value));
      if ('notIn' in ops) checks.push(!(ops.notIn as unknown[]).includes(value));
      if ('gte' in ops) checks.push(at >= time(ops.gte));
      if ('gt' in ops) checks.push(at > time(ops.gt));
      if ('lte' in ops) checks.push(at <= time(ops.lte));
      if ('lt' in ops) checks.push(at < time(ops.lt));
      if ('not' in ops) checks.push(value !== ops.not);
      if (checks.length > 0) return checks.every(Boolean);
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
      /** How many requests match, for the approvers' digest. */
      async count({ where }) {
        return get().requests.filter((row) => matches(row, where)).length;
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
      /** The sum of the receipts that match: money received in a range. */
      async aggregate({ where }) {
        const rows = get().receipts.filter((row) => matches(row, where));
        return { _sum: { amount: rows.length ? rows.reduce((sum, row) => sum + row.amount, 0) : null } };
      },
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
        const rows = get().credits.filter((row) => matches(row, where));
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
    platformBillingNotice: {
      /** Writes a notice, refusing a second for the same organization, kind, period and day. */
      async create({ data }) {
        const store = get();
        // The `@@unique([organizationId, kind, periodKey, day])`, as Postgres enforces it.
        const taken = store.notices.some(
          (row) =>
            row.organizationId === data.organizationId &&
            row.kind === data.kind &&
            row.periodKey === data.periodKey &&
            row.day.getTime() === data.day.getTime(),
        );
        if (taken) throw uniqueViolation();
        const row: NoticeRow = { id: id('ntc'), sentAt: null, ...data, data: structuredClone(data.data) };
        store.notices.push(row);
        return structuredClone(row);
      },
      /** The unsent notices, oldest first. */
      async findMany({ where, take }) {
        return get()
          .notices.filter((row) => matches(row, where))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, take)
          .map((row) => structuredClone(row));
      },
      /** How many notices match: the stale unsent ones, for the log. */
      async count({ where }) {
        return get().notices.filter((row) => matches(row, where)).length;
      },
      /** Marks a notice sent. */
      async update({ where, data }) {
        const row = get().notices.find((one) => one.id === where.id);
        if (!row) throw new Error('No such notice');
        Object.assign(row, data);
        return structuredClone(row);
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
  people: PlatformBillingPeople & { members: Set<string>; organizationList: Array<{ id: string; name: string }> };
  reports: PlatformBillingReportsService;
  /** Every notice told, in order; `failing` makes the next sends fail, as a mail server down would. */
  notifier: PlatformBillingNotifier & { told: Array<{ what: string; notice: unknown }>; failing: boolean };
  reads: PlatformBillingService;
  writes: PlatformBillingWriteService;
  daily: PlatformBillingDailyCheck;
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
    /** Every organization is "Acme" here. */
    async organizationName() {
      return 'Acme';
    },
    /** The organizations the platform's standings walk: set by a test, listed by id as permissions would. */
    organizationList: [] as Array<{ id: string; name: string }>,
    /** A page by id ascending after `after`, as the app's adapter answers. */
    async organizations(after: string | null, limit: number) {
      return [...people.organizationList]
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((organization) => after === null || organization.id > after)
        .slice(0, limit);
    },
  };

  const notifier = {
    told: [] as Array<{ what: string; notice: unknown }>,
    failing: false,
    /** Records a reminder, or fails while `failing`. */
    async reminder(notice: unknown) {
      if (notifier.failing) return false;
      notifier.told.push({ what: 'reminder', notice });
      return true;
    },
    /** Records a digest, or fails while `failing`. */
    async approversDigest(notice: unknown) {
      if (notifier.failing) return false;
      notifier.told.push({ what: 'approvers', notice });
      return true;
    },
    /** Records a request notice, or fails while `failing`. */
    async requestChanged(notice: unknown) {
      if (notifier.failing) return false;
      notifier.told.push({ what: 'request', notice });
      return true;
    },
  } as FakeBilling['notifier'];

  const reads = new PlatformBillingService(client, subscriptions, plans);
  const writes = new PlatformBillingWriteService(client, reads, subscriptions, people, notifier);
  const daily = new PlatformBillingDailyCheck(client, reads, notifier);
  const reports = new PlatformBillingReportsService(reads, client, people);
  return { store: () => store, client, subscriptions, plans, people, notifier, reads, writes, daily, reports };
}

/** Puts `organizationId` on `planKey` for the period `[start, end)`, access to `accessUntil` (days, Manila). */
export function giveSubscription(
  billing: FakeBilling,
  organizationId: string,
  planKey: string,
  start: string,
  end: string,
  accessUntil: string,
  options: { trial?: boolean; timeZone?: string } = {},
): void {
  const zone = options.timeZone ?? 'Asia/Manila';
  billing.store().subscriptions.set(organizationId, {
    subscriptionId: id('sub'),
    planKey,
    planArchived: false,
    periodStart: platformDayStart(start, zone),
    currentPeriodEnd: platformDayStart(end, zone),
    billingDay: Number(start.slice(8, 10)),
    accessUntil: platformDayStart(accessUntil, zone),
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
