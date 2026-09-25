import type { NotificationWriteClient } from '../src/server/notification.repository.js';

/**
 * An in-memory stand-in for the host's Prisma client — the queue module's fake,
 * reshaped for these two tables.
 *
 * It keeps the promises the rules under test depend on:
 *   - the UNIQUE constraint on `(recipientId, dedupeKey)`, raising `P2002`, and
 *     `skipDuplicates` skipping instead — what makes a deduped fan-out work;
 *   - the ROLLBACK of a failed transaction.
 *
 * ⚠ It supports only the operators the services send (`in`, `not`, `lt`, `gt`,
 * `gte`, `lte`, `OR`) and THROWS on anything else, so a new query cannot pass
 * against a fake that silently ignored its filter.
 *
 * Time starts at the REAL now and moves one millisecond per row, so rows
 * written one after another order strictly — and the sender's flood window,
 * which reads the real clock, sees them as recent. To age rows, edit
 * `state` directly.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export const TABLES = ['notificationItem', 'notificationBatch'] as const;
export type TableName = (typeof TABLES)[number];
export type FakeState = Record<TableName, Row[]>;

/** Mirrors prisma/notification.prisma. A NULL in any field exempts the row, as in Postgres. */
const UNIQUES: Record<TableName, string[][]> = {
  notificationItem: [['id'], ['recipientId', 'dedupeKey']],
  notificationBatch: [['id']],
};

export function emptyState(): FakeState {
  return { notificationItem: [], notificationBatch: [] };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value);

const comparable = (value: unknown): number | string =>
  value instanceof Date ? value.getTime() : (value as number | string);

const same = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Where[]).some((branch) => matches(row, branch));
    if (!isPlainObject(condition)) return same(row[key], condition);

    return Object.entries(condition).every(([operator, value]) => {
      const field = row[key];
      switch (operator) {
        case 'in':
          return (value as unknown[]).some((candidate) => same(field, candidate));
        case 'not':
          return !same(field, value) && !(value === null && field === null);
        case 'lt':
          return field !== null && comparable(field) < comparable(value);
        case 'gt':
          return field !== null && comparable(field) > comparable(value);
        case 'gte':
          return field !== null && comparable(field) >= comparable(value);
        case 'lte':
          return field !== null && comparable(field) <= comparable(value);
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
        const x = comparable(a[field]);
        const y = comparable(b[field]);
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
  const clock = Date.now() - 10_000;
  let tick = 0;
  /** Each call is a new millisecond, so rows written one after another order strictly. */
  const now = () => new Date(clock + tick++);
  const nextId = (table: TableName) => `${table}-${String(++tick).padStart(6, '0')}`;

  const defaults: Record<TableName, (id: string) => Row> = {
    notificationItem: (id) => {
      const at = now();
      return {
        id,
        severity: 'info',
        body: null,
        organizationId: null,
        workspaceId: null,
        contextLabel: null,
        actions: [],
        dedupeKey: null,
        groupKey: null,
        groupCount: 1,
        createdAt: at,
        occurredAt: at,
        readAt: null,
        archivedAt: null,
        recalledAt: null,
        expiresAt: null,
      };
    },
    notificationBatch: (id) => ({ id, senderId: null, createdAt: now(), recalledAt: null, recalledById: null }),
  };

  function clashes(table: TableName, candidate: Row, ignore?: Row): string[] | null {
    for (const fields of UNIQUES[table]) {
      if (fields.some((field) => candidate[field] === null || candidate[field] === undefined)) continue;
      const clash = state[table].some(
        (row) => row !== ignore && fields.every((field) => same(row[field], candidate[field])),
      );
      if (clash) return fields;
    }
    return null;
  }

  function apply(table: TableName, row: Row, data: Row): void {
    const next = { ...row };
    for (const [field, value] of Object.entries(data)) {
      next[field] =
        isPlainObject(value) && 'increment' in value ? (row[field] as number) + (value.increment as number) : value;
    }
    const clash = clashes(table, next, row);
    if (clash) throw uniqueViolation(table, clash);
    Object.assign(row, next);
  }

  function delegate(table: TableName) {
    const create = async ({ data }: { data: Row }) => {
      const row = { ...defaults[table](nextId(table)), ...data };
      const clash = clashes(table, row);
      if (clash) throw uniqueViolation(table, clash);
      state[table].push(row);
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
      createManyAndReturn: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
        const written: Row[] = [];
        for (const item of data) {
          const row = { ...defaults[table](nextId(table)), ...item };
          const clash = clashes(table, row);
          if (clash && skipDuplicates) continue;
          if (clash) throw uniqueViolation(table, clash);
          state[table].push(row);
          written.push({ ...row });
        }
        return written;
      },
      update: async ({ where, data }: { where: Where; data: Row }) => {
        const row = state[table].find((candidate) => matches(candidate, where));
        if (!row) throw Object.assign(new Error(`No ${table} row to update`), { code: 'P2025' });
        apply(table, row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        const targets = state[table].filter((row) => matches(row, where));
        for (const row of targets) apply(table, row, data);
        return { count: targets.length };
      },
    };
  }

  const delegates = Object.fromEntries(TABLES.map((table) => [table, delegate(table)]));

  const client = {
    ...delegates,
    /** ⚠ ROLLS BACK on a throw, by restoring a snapshot. */
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

  return { client: client as unknown as NotificationWriteClient, state };
}
