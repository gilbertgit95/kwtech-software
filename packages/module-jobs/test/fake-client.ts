import type { JobsWriteClient } from '../src/server/jobs.repository.js';

/**
 * An in-memory stand-in for the host's Prisma client — `module-task`'s fake,
 * with the runner's four tables.
 *
 * The payoff of `JobsTransaction` being STRUCTURAL: the module opens no
 * connection, so its tests need no database. The fake keeps the promises the
 * queue's rules rest on —
 *
 *   - `updateMany` is a COMPARE-AND-SET: it changes only the rows its `where`
 *     still matches, and says how many;
 *   - the `@unique` on `jobProcess.activeRunId`, raising `P2002`;
 *   - the ROLLBACK of a failed transaction;
 *   - `updatedAt` moving on every update, as `@updatedAt` does.
 *
 * ⚠ It supports only the operators the services send, and throws on anything
 * else, so a new query cannot pass against a fake that silently ignored its
 * filter.
 *
 * What it CANNOT show is two servers at once: the queue lock's row lock is
 * Postgres's, and here everything is one thread. The limit on runs at once is
 * tested as the count it reads; that claims wait on each other is the
 * database's promise.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export const TABLES = ['jobProcess', 'jobRun', 'jobControl', 'jobQueueLock'] as const;
export type TableName = (typeof TABLES)[number];
export type FakeState = Record<TableName, Row[]>;

/** Mirrors prisma/jobs.prisma. A null `activeRunId` is not a clash, as in Postgres. */
const UNIQUES: Record<TableName, string[][]> = {
  jobProcess: [['key'], ['activeRunId']],
  jobRun: [['id']],
  jobControl: [['id']],
  jobQueueLock: [['id']],
};

const DEFAULTS: Record<TableName, (now: Date) => Row> = {
  jobProcess: (now) => ({
    deprecatedAt: null,
    schedule: null,
    scheduleSetById: null,
    scheduleSetAt: null,
    pausedAt: null,
    pausedById: null,
    pauseReason: null,
    activeRunId: null,
    lastQueuedAt: null,
    createdAt: now,
    updatedAt: now,
  }),
  jobRun: () => ({
    startedAt: null,
    finishedAt: null,
    leaseExpiresAt: null,
    handled: 0,
    skippedLate: 0,
    leftForNext: 0,
    note: null,
    error: null,
  }),
  // `id` is the database's (`@default(cuid())`); `fakeClient` numbers them.
  jobControl: () => ({ reason: null, scheduleFrom: null, scheduleTo: null }),
  jobQueueLock: (now) => ({ touchedAt: now }),
};

export function emptyState(): FakeState {
  return Object.fromEntries(TABLES.map((table) => [table, []])) as unknown as FakeState;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value);

const same = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

function compare(a: unknown, b: unknown): number {
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
        case 'notIn':
          return !(value as unknown[]).some((candidate) => same(row[key], candidate));
        case 'not':
          // Only "is not null" is sent: resuming takes a process that is paused.
          if (value !== null) throw new Error(`fake client: unsupported 'not' value on ${key}`);
          return row[key] != null;
        case 'lt':
          // A null never compares, as in SQL: a run with no lease has not lapsed.
          return row[key] != null && compare(row[key], value) < 0;
        case 'lte':
          return row[key] != null && compare(row[key], value) <= 0;
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

export interface FakeClient extends JobsWriteClient {
  state: FakeState;
}

export function fakeClient(state: FakeState = emptyState()): FakeClient {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 9, 5, 0, 0, 0, tick++));

  function assertUnique(table: TableName, candidate: Row, ignore?: Row): void {
    for (const fields of UNIQUES[table]) {
      if (fields.some((field) => candidate[field] == null)) continue;
      const clash = state[table].some(
        (row) => row !== ignore && fields.every((field) => same(row[field], candidate[field])),
      );
      if (clash) {
        throw Object.assign(new Error(`Unique constraint failed on ${table}(${fields.join(', ')})`), { code: 'P2002' });
      }
    }
  }

  function apply(table: TableName, row: Row, data: Row): void {
    const next = { ...row, ...data };
    assertUnique(table, next, row);
    Object.assign(row, next);
    if ('updatedAt' in row) row.updatedAt = now();
  }

  function delegate(table: TableName) {
    const create = async ({ data }: { data: Row }) => {
      const row = { ...DEFAULTS[table](now()), ...copy(data) };
      if (table === 'jobControl' && row.id == null)
        row.id = `control-${String(state[table].length + 1).padStart(4, '0')}`;
      assertUnique(table, row);
      state[table].push(row);
      return copy(row);
    };

    return {
      findUnique: async ({ where }: { where: Where }) => {
        const row = state[table].find((candidate) => matches(candidate, where));
        return row ? copy(row) : null;
      },
      findMany: async (args: { where?: Where; orderBy?: unknown; take?: number }) => {
        const rows = sortRows(
          state[table].filter((row) => matches(row, args.where)),
          args.orderBy,
        );
        return rows.slice(0, args.take).map((row) => copy(row));
      },
      count: async ({ where }: { where: Where }) => state[table].filter((row) => matches(row, where)).length,
      create,
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        const rows = state[table].filter((row) => matches(row, where));
        for (const row of rows) apply(table, row, data);
        return { count: rows.length };
      },
      upsert: async ({ where, create: createData, update }: { where: Where; create: Row; update: Row }) => {
        const row = state[table].find((candidate) => matches(candidate, where));
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
