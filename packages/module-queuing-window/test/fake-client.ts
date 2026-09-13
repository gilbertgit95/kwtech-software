import type { QueueWriteClient } from '../src/server/queue.repository.js';

/**
 * An in-memory stand-in for the host's Prisma client.
 *
 * The payoff of `QueueTransaction` being STRUCTURAL: the module opens no
 * connection, so its tests need no database. The fake keeps the promises that
 * matter to the rules under test —
 *
 *   - the UNIQUE CONSTRAINTS, raising Prisma's `P2002` exactly where the schema
 *     would, because "two supervisors press Start" and "two windows call one
 *     number" are refused by the database, not by code;
 *   - the ROLLBACK of a failed transaction, because the allocator retries by
 *     running the whole transaction again, and a fake that kept the half-written
 *     state would make that retry call the wrong number.
 *
 * ⚠ It supports only the operators the services send (`in`, `not`, `gt`, `OR`)
 * and throws on anything else, so a new query cannot pass against a fake that
 * silently ignored its filter.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export const TABLES = [
  'queueSettings',
  'queueLine',
  'queueWindow',
  'queueWindowLine',
  'queueSeat',
  'queueSession',
  'queueDisplayPass',
  'queueSequence',
  'queueTicket',
  'queueStaffNickname',
] as const;

export type TableName = (typeof TABLES)[number];
export type FakeState = Record<TableName, Row[]>;

/** Mirrors prisma/queue.prisma. A NULL in any field exempts the row, as in Postgres. */
const UNIQUES: Record<TableName, string[][]> = {
  queueSettings: [['workspaceId']],
  queueLine: [['id'], ['workspaceId', 'prefix']],
  queueWindow: [['id'], ['workspaceId', 'nameKey']],
  queueWindowLine: [['windowId', 'lineId']],
  queueSeat: [['id'], ['windowId'], ['workspaceId', 'userId']],
  queueSession: [['id'], ['openWorkspaceId']],
  queueDisplayPass: [['id'], ['tokenHash']],
  queueSequence: [['lineId', 'sessionId']],
  queueTicket: [['id'], ['lineId', 'sessionId', 'cycle', 'number'], ['sessionId', 'clientRequestId']],
  queueStaffNickname: [['workspaceId', 'userId']],
};

/** What the database fills in. Every nullable column is present, so a filter on it means something. */
const DEFAULTS: Record<TableName, (id: string, now: Date) => Row> = {
  queueSettings: (_id, now) => ({
    enabled: true,
    showStaffNames: false,
    voiceEnabled: true,
    voiceType: 'any',
    voicePitch: 'normal',
    voiceSpeed: 'normal',
    voiceVolume: 'full',
    voiceRepeat: 1,
    createdAt: now,
    updatedAt: now,
  }),
  queueLine: (id, now) => ({
    id,
    startNumber: 1,
    endNumber: 999,
    padTo: 3,
    sortOrder: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }),
  queueWindow: (id, now) => ({ id, sortOrder: 0, archivedAt: null, createdAt: now, updatedAt: now }),
  queueWindowLine: () => ({}),
  queueSeat: (id, now) => ({ id, assignedAt: now }),
  queueSession: (id, now) => ({
    id,
    openWorkspaceId: null,
    displayCode: null,
    failedCodeAttempts: 0,
    continuedNumbering: false,
    startedAt: now,
    stoppedById: null,
    stoppedAt: null,
  }),
  queueDisplayPass: (id, now) => ({ id, createdAt: now, lastSeenAt: null }),
  queueSequence: (_id, now) => ({ cycle: 0, updatedAt: now }),
  queueTicket: (id, now) => ({
    id,
    status: 'called',
    recallCount: 0,
    firstCalledAt: now,
    calledAt: now,
    completedAt: null,
    clientRequestId: null,
  }),
  queueStaffNickname: (_id, now) => ({ updatedAt: now }),
};

export function emptyState(): FakeState {
  return Object.fromEntries(TABLES.map((table) => [table, []])) as unknown as FakeState;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value);

const same = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Where[]).some((branch) => matches(row, branch));
    // A compound unique input — `lineId_sessionId: { lineId, sessionId }` — names no column.
    if (!(key in row) && isPlainObject(condition)) return matches(row, condition);
    if (!isPlainObject(condition)) return same(row[key], condition);

    return Object.entries(condition).every(([operator, value]) => {
      switch (operator) {
        case 'in':
          return (value as unknown[]).some((candidate) => same(row[key], candidate));
        case 'not':
          return !same(row[key], value);
        case 'gt':
          return (row[key] as number) > (value as number);
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
        const x = a[field] instanceof Date ? (a[field] as Date).getTime() : (a[field] as number | string);
        const y = b[field] instanceof Date ? (b[field] as Date).getTime() : (b[field] as number | string);
        if (x === y) continue;
        return (x < y ? -1 : 1) * (direction === 'desc' ? -1 : 1);
      }
    }
    return 0;
  });
}

function uniqueViolation(table: TableName, fields: string[]): Error {
  return Object.assign(new Error(`Unique constraint failed on ${table}(${fields.join(', ')})`), { code: 'P2002' });
}

export function fakeClient(state: FakeState = emptyState()) {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 8, 13, 9, 0, 0, tick++));
  const nextId = (table: TableName) => `${table}-${++tick}`;

  function assertUnique(table: TableName, candidate: Row, ignore?: Row): void {
    for (const fields of UNIQUES[table]) {
      if (fields.some((field) => candidate[field] === null || candidate[field] === undefined)) continue;
      const clash = state[table].some(
        (row) => row !== ignore && fields.every((field) => same(row[field], candidate[field])),
      );
      if (clash) throw uniqueViolation(table, fields);
    }
  }

  function apply(table: TableName, row: Row, data: Row): void {
    const next = { ...row };
    for (const [field, value] of Object.entries(data)) {
      next[field] =
        isPlainObject(value) && 'increment' in value ? (row[field] as number) + (value.increment as number) : value;
    }
    if ('updatedAt' in next) next.updatedAt = now();
    assertUnique(table, next, row);
    Object.assign(row, next);
  }

  function delegate(table: TableName) {
    const create = async ({ data }: { data: Row }) => {
      const row = { ...DEFAULTS[table](nextId(table), now()), ...data };
      assertUnique(table, row);
      state[table].push(row);
      return { ...row };
    };
    const update = async ({ where, data }: { where: Where; data: Row }) => {
      const row = state[table].find((candidate) => matches(candidate, where));
      if (!row) throw Object.assign(new Error(`No ${table} row to update`), { code: 'P2025' });
      apply(table, row, data);
      return { ...row };
    };

    return {
      findUnique: async ({ where }: { where: Where }) => {
        const row = state[table].find((candidate) => matches(candidate, where));
        return row ? { ...row } : null;
      },
      findFirst: async ({ where, orderBy }: { where?: Where; orderBy?: unknown }) => {
        const row = sortRows(
          state[table].filter((candidate) => matches(candidate, where)),
          orderBy,
        )[0];
        return row ? { ...row } : null;
      },
      findMany: async ({ where, orderBy, take }: { where?: Where; orderBy?: unknown; take?: number } = {}) => {
        const found = sortRows(
          state[table].filter((candidate) => matches(candidate, where)),
          orderBy,
        );
        return (take === undefined ? found : found.slice(0, take)).map((row) => ({ ...row }));
      },
      count: async ({ where }: { where?: Where } = {}) => state[table].filter((row) => matches(row, where)).length,
      create,
      update,
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        const targets = state[table].filter((row) => matches(row, where));
        for (const row of targets) apply(table, row, data);
        return { count: targets.length };
      },
      deleteMany: async ({ where }: { where?: Where } = {}) => {
        const before = state[table].length;
        state[table] = state[table].filter((row) => !matches(row, where));
        return { count: before - state[table].length };
      },
      upsert: async ({ where, create: createData, update: updateData }: { where: Where; create: Row; update: Row }) =>
        state[table].some((row) => matches(row, where))
          ? update({ where, data: updateData })
          : create({ data: createData }),
    };
  }

  const delegates = Object.fromEntries(TABLES.map((table) => [table, delegate(table)]));

  const client = {
    ...delegates,
    /**
     * ⚠ ROLLS BACK on a throw, by restoring a snapshot. The allocator's retry
     * depends on it: a lost race throws after the sequence moved, and the retry
     * must see the sequence where it was.
     */
    async $transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      const snapshot = structuredClone(state);
      try {
        return await fn(client as never);
      } catch (error) {
        for (const table of TABLES) state[table] = snapshot[table];
        throw error;
      }
    },
  };

  return { client: client as unknown as QueueWriteClient, state };
}
