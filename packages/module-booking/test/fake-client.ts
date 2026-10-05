import type { BookingWriteClient } from '../src/server/booking.repository.js';

/**
 * An in-memory stand-in for the host's Prisma client — `module-task`'s fake,
 * with the booking tables.
 *
 * The payoff of `BookingTransaction` being STRUCTURAL: the module opens no
 * connection, so its tests need no database. The fake keeps the promises that
 * matter to the rules under test —
 *
 *   - ⚠ THE EXCLUSION CONSTRAINT `booking_appointment_no_overlap`: two rows of
 *     one resource that both HOLD a slot and whose blocked ranges overlap are
 *     refused with SQLSTATE `23P01`, exactly as the migration's constraint
 *     refuses them. So a service that skipped its own look would still fail
 *     here, the way it would in Postgres;
 *   - the ROLLBACK of a failed transaction;
 *   - `updatedAt` moving on every update, as `@updatedAt` does;
 *   - the `@@id([appointmentId, startsAt])` of a reminder, raising `P2002` —
 *     the claim the reminder process's idempotence rests on — and the one
 *     relation filter its sweep sends (`reminders: { none }`).
 *
 * ⚠ It supports only the operators the services send, and throws on anything
 * else, so a new query cannot pass against a fake that silently ignored its
 * filter.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export const TABLES = [
  'bookingService',
  'bookingResource',
  'bookingServiceResource',
  'bookingHours',
  'bookingException',
  'bookingAppointment',
  'bookingChange',
  'bookingReminder',
  'bookingSettings',
] as const;
export type TableName = (typeof TABLES)[number];
export type FakeState = Record<TableName, Row[]>;

/** Mirrors prisma/booking.prisma. */
const UNIQUES: Record<TableName, string[][]> = {
  bookingService: [['id']],
  bookingResource: [['id']],
  bookingServiceResource: [['serviceId', 'resourceId']],
  bookingHours: [['id']],
  bookingException: [['id']],
  bookingAppointment: [['id'], ['manageTokenHash']],
  bookingChange: [['id']],
  bookingReminder: [['appointmentId', 'startsAt']],
  bookingSettings: [['workspaceId'], ['publicLinkId']],
};

/** The statuses in the constraint's WHERE — written out, as the migration writes them, not imported from the domain. */
const HOLDING = new Set(['pending', 'confirmed', 'arrived', 'done']);

const DEFAULTS: Record<TableName, (id: string, now: Date) => Row> = {
  bookingService: (id, now) => ({
    id,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    price: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }),
  bookingResource: (id, now) => ({ id, userId: null, archivedAt: null, createdAt: now, updatedAt: now }),
  bookingServiceResource: () => ({}),
  bookingHours: (id) => ({ id }),
  bookingException: (id, now) => ({
    id,
    resourceId: null,
    startMinute: null,
    endMinute: null,
    note: '',
    createdAt: now,
  }),
  bookingAppointment: (id, now) => ({
    id,
    customerPhone: null,
    customerEmail: null,
    customerId: null,
    note: '',
    createdById: null,
    decidedById: null,
    decidedAt: null,
    pendingSince: null,
    manageTokenHash: null,
    createdAt: now,
    updatedAt: now,
  }),
  bookingChange: (id, now) => ({
    id,
    actorId: null,
    fromStartsAt: null,
    toStartsAt: null,
    fromResourceId: null,
    toResourceId: null,
    reason: '',
    createdAt: now,
  }),
  bookingReminder: (_id, now) => ({ createdAt: now }),
  bookingSettings: (_id, now) => ({
    slotMinutes: 30,
    reminderMinutes: 15,
    publicEnabled: false,
    publicLinkId: null,
    publicTitle: '',
    publicNote: '',
    leadMinutes: 60,
    horizonDays: 30,
    cutoffMinutes: 120,
    lapseHours: 24,
    createdAt: now,
    updatedAt: now,
  }),
};

export function emptyState(): FakeState {
  return Object.fromEntries(TABLES.map((table) => [table, []])) as unknown as FakeState;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value);

const same = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

function compare(a: unknown, b: unknown): number {
  // Postgres sorts NULL LAST ascending.
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  const x = a instanceof Date ? a.getTime() : (a as number | string);
  const y = b instanceof Date ? b.getTime() : (b as number | string);
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (!isPlainObject(condition)) return same(row[key], condition);

    return Object.entries(condition).every(([operator, value]) => {
      switch (operator) {
        case 'in':
          return (value as unknown[]).some((candidate) => same(row[key], candidate));
        case 'not':
          return value === null ? row[key] !== null && row[key] !== undefined : !same(row[key], value);
        case 'gt':
          return compare(row[key], value) > 0;
        case 'gte':
          return compare(row[key], value) >= 0;
        case 'lt':
          return compare(row[key], value) < 0;
        case 'lte':
          return compare(row[key], value) <= 0;
        default:
          throw new Error(`fake client: unsupported operator '${operator}' on ${key}`);
      }
    });
  });
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  const clauses = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<string, 'asc' | 'desc'>[];
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      for (const [field, direction] of Object.entries(clause)) {
        const order = compare(a[field], b[field]);
        if (order !== 0) return order * (direction === 'desc' ? -1 : 1);
      }
    }
    return 0;
  });
}

const copy = (row: Row): Row => ({ ...row });

export interface FakeClient extends BookingWriteClient {
  state: FakeState;
}

export function fakeClient(state: FakeState = emptyState()): FakeClient {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 9, 5, 9, 0, 0, tick++));
  const nextId = (table: TableName) => `${table}-${++tick}`;

  function assertUnique(table: TableName, candidate: Row, ignore?: Row): void {
    for (const fields of UNIQUES[table]) {
      // As Postgres: NULLs are distinct, so two rows with no value in a unique column do not clash.
      if (fields.some((field) => candidate[field] === null || candidate[field] === undefined)) continue;
      const clash = state[table].some(
        (row) => row !== ignore && fields.every((field) => same(row[field], candidate[field])),
      );
      if (clash) {
        throw Object.assign(new Error(`Unique constraint failed on ${table}(${fields.join(', ')})`), { code: 'P2002' });
      }
    }
  }

  /** `booking_appointment_no_overlap`: EXCLUDE (resourceId WITH =, the blocked range WITH &&) WHERE it holds a slot. */
  function assertNoOverlap(candidate: Row, ignore?: Row): void {
    if (!HOLDING.has(candidate.status as string)) return;
    const clash = state.bookingAppointment.some(
      (row) =>
        row !== ignore &&
        HOLDING.has(row.status as string) &&
        row.resourceId === candidate.resourceId &&
        (row.blockedFrom as Date).getTime() < (candidate.blockedUntil as Date).getTime() &&
        (candidate.blockedFrom as Date).getTime() < (row.blockedUntil as Date).getTime(),
    );
    if (clash) {
      throw Object.assign(
        new Error('conflicting key value violates exclusion constraint "booking_appointment_no_overlap"'),
        { code: '23P01' },
      );
    }
  }

  function apply(table: TableName, row: Row, data: Row): void {
    const next = { ...copy(row), ...data };
    assertUnique(table, next, row);
    if (table === 'bookingAppointment') assertNoOverlap(next, row);
    Object.assign(row, next);
    if ('updatedAt' in row) row.updatedAt = now();
  }

  /**
   * `matches`, plus the one RELATION filter the reminder sweep sends on a
   * booking: "no reminder like this yet". Any other relation filter still
   * throws, from `matches`, as an unsupported operator.
   */
  function test(table: TableName, row: Row, where: Where | undefined): boolean {
    if (table !== 'bookingAppointment' || !where) return matches(row, where);
    const { reminders, ...rest } = where as Where & { reminders?: { none?: Where } };
    if (reminders) {
      const { none } = reminders;
      if (!none) throw new Error('fake client: only `none` is supported on reminders');
      if (state.bookingReminder.some((reminder) => reminder.appointmentId === row.id && matches(reminder, none))) {
        return false;
      }
    }
    return matches(row, rest);
  }

  function delegate(table: TableName) {
    const create = async ({ data }: { data: Row }) => {
      const row = { ...DEFAULTS[table](nextId(table), now()), ...copy(data) };
      assertUnique(table, row);
      if (table === 'bookingAppointment') assertNoOverlap(row);
      state[table].push(row);
      return copy(row);
    };
    const find = ({ where }: { where: Where }) => {
      const row = state[table].find((candidate) => test(table, candidate, where));
      return row ? copy(row) : null;
    };

    return {
      findFirst: async (args: { where: Where }) => find(args),
      findUnique: async (args: { where: Where }) => find(args),
      findMany: async (args: { where?: Where; orderBy?: unknown; take?: number }) => {
        const rows = sortRows(
          state[table].filter((row) => test(table, row, args.where)),
          args.orderBy,
        );
        return rows.slice(0, args.take).map((row) => copy(row));
      },
      count: async ({ where }: { where: Where }) => state[table].filter((row) => test(table, row, where)).length,
      create,
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        const rows = state[table].filter((row) => test(table, row, where));
        for (const row of rows) apply(table, row, data);
        return { count: rows.length };
      },
      deleteMany: async ({ where }: { where: Where }) => {
        const rows = state[table].filter((row) => test(table, row, where));
        state[table] = state[table].filter((row) => !rows.includes(row));
        return { count: rows.length };
      },
      upsert: async ({ where, create: createData, update }: { where: Where; create: Row; update: Row }) => {
        const row = state[table].find((candidate) => test(table, candidate, where));
        if (!row) return create({ data: createData });
        apply(table, row, update);
        return copy(row);
      },
    };
  }

  const client = {
    state,
    ...Object.fromEntries(TABLES.map((table) => [table, delegate(table)])),
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const snapshot = Object.fromEntries(
        TABLES.map((table) => [table, state[table].map((row) => copy(row))]),
      ) as FakeState;
      try {
        return await fn(client);
      } catch (error) {
        for (const table of TABLES) state[table] = snapshot[table];
        throw error;
      }
    },
  };
  return client as unknown as FakeClient;
}
