import type { StudioWriteClient } from '../src/server/studio.repository.js';

/**
 * An in-memory stand-in for the host's Prisma client.
 *
 * The payoff of `StudioTransaction` being STRUCTURAL: the module opens no
 * connection, so its tests need no database. The fake keeps the promises that
 * matter to the rules under test —
 *
 *   - the `@@unique` on a calibration's (workspace, owner, name), raising
 *     `P2002` as Prisma does, so the duplicate-name refusal is exercised for real;
 *   - the ROLLBACK of a failed transaction, so a layout refused at its cap
 *     leaves nothing behind;
 *   - `updatedAt` moving on every update, as `@updatedAt` does.
 *
 * ⚠ It supports only the operators the services send, and throws on anything
 * else, so a new query cannot pass against a fake that silently ignored its
 * filter.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export const TABLES = ['studioLayout', 'studioCalibration', 'studioLog', 'studioSettings'] as const;
export type TableName = (typeof TABLES)[number];
export type FakeState = Record<TableName, Row[]>;

/** Mirrors prisma/studio.prisma. */
const UNIQUES: Record<TableName, string[][]> = {
  studioLayout: [['id']],
  studioCalibration: [['id'], ['workspaceId', 'ownerId', 'name']],
  studioLog: [['id']],
  studioSettings: [['workspaceId']],
};

const DEFAULTS: Record<TableName, (id: string, now: Date) => Row> = {
  studioLayout: (id, now) => ({ id, visibility: 'private', version: 1, createdAt: now, updatedAt: now }),
  studioCalibration: (id, now) => ({
    id,
    scaleX: 10000,
    scaleY: 10000,
    offsetX: 0,
    offsetY: 0,
    createdAt: now,
    updatedAt: now,
  }),
  studioLog: (id, now) => ({ id, fileNames: [], createdAt: now }),
  studioSettings: (_id, now) => ({ keymap: null, version: 1, createdAt: now, updatedAt: now }),
};

export function emptyState(): FakeState {
  return { studioLayout: [], studioCalibration: [], studioLog: [], studioSettings: [] };
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
        case 'not':
          return !same(row[key], value);
        case 'lt':
          return compare(row[key], value) < 0;
        default:
          throw new Error(`fake client: unsupported operator '${operator}' on ${key}`);
      }
    });
  });
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  const clauses = (Array.isArray(orderBy) ? orderBy : []) as Record<string, 'asc' | 'desc'>[];
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

/** A copy deep enough that a caller cannot reach into the store: specs and name lists are cloned. */
function copy(row: Row): Row {
  return structuredClone(row);
}

export interface FakeClient extends StudioWriteClient {
  state: FakeState;
  /** Run before the next `updateMany` / `deleteMany` on layouts — to lose a race on purpose. */
  beforeNextLayoutWrite(hook: () => void): void;
  /** Move the fake's clock, so rows can be created at chosen instants. */
  setNow(now: Date): void;
}

export function fakeClient(state: FakeState = emptyState()): FakeClient {
  let tick = 0;
  let base = Date.UTC(2026, 9, 5, 9, 0, 0);
  const now = () => new Date(base + tick++);
  const nextId = (table: TableName) => `${table}-${++tick}`;
  let hook: (() => void) | null = null;
  const runHook = () => {
    const pending = hook;
    hook = null;
    pending?.();
  };

  function assertUnique(table: TableName, candidate: Row, ignore?: Row): void {
    for (const fields of UNIQUES[table]) {
      const clash = state[table].some(
        (row) => row !== ignore && fields.every((field) => same(row[field], candidate[field])),
      );
      if (clash) {
        throw Object.assign(new Error(`Unique constraint failed on ${table}(${fields.join(', ')})`), { code: 'P2002' });
      }
    }
  }

  function apply(table: TableName, row: Row, data: Row): void {
    const next = { ...row };
    for (const [field, value] of Object.entries(data)) {
      next[field] =
        isPlainObject(value) && 'increment' in value ? (row[field] as number) + (value.increment as number) : value;
    }
    assertUnique(table, next, row);
    Object.assign(row, next);
    if ('updatedAt' in row) row.updatedAt = now();
  }

  function delegate(table: TableName) {
    return {
      findFirst: async ({ where }: { where: Where }) => {
        const row = state[table].find((candidate) => matches(candidate, where));
        return row ? copy(row) : null;
      },
      findUnique: async ({ where }: { where: Where }) => {
        const row = state[table].find((candidate) => matches(candidate, where));
        return row ? copy(row) : null;
      },
      upsert: async ({ where, create, update }: { where: Where; create: Row; update: Row }) => {
        const row = state[table].find((candidate) => matches(candidate, where));
        if (!row) {
          const made = { ...DEFAULTS[table](nextId(table), now()), ...copy(create) };
          assertUnique(table, made);
          state[table].push(made);
          return copy(made);
        }
        apply(table, row, update);
        return copy(row);
      },
      findMany: async (args: { where?: Where; orderBy?: unknown; take?: number }) => {
        const rows = sortRows(
          state[table].filter((row) => matches(row, args.where)),
          args.orderBy,
        );
        return rows.slice(0, args.take).map(copy);
      },
      count: async ({ where }: { where: Where }) => state[table].filter((row) => matches(row, where)).length,
      create: async ({ data }: { data: Row }) => {
        const row = { ...DEFAULTS[table](nextId(table), now()), ...copy(data) };
        assertUnique(table, row);
        state[table].push(row);
        return copy(row);
      },
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        if (table === 'studioLayout') runHook();
        const rows = state[table].filter((row) => matches(row, where));
        for (const row of rows) apply(table, row, data);
        return { count: rows.length };
      },
      deleteMany: async ({ where }: { where: Where }) => {
        if (table === 'studioLayout') runHook();
        const rows = state[table].filter((row) => matches(row, where));
        state[table] = state[table].filter((row) => !rows.includes(row));
        return { count: rows.length };
      },
    };
  }

  const client = {
    state,
    beforeNextLayoutWrite(next: () => void) {
      hook = next;
    },
    setNow(next: Date) {
      base = next.getTime();
      tick = 0;
    },
    studioLayout: delegate('studioLayout'),
    studioCalibration: delegate('studioCalibration'),
    studioLog: delegate('studioLog'),
    studioSettings: delegate('studioSettings'),
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const snapshot = Object.fromEntries(TABLES.map((table) => [table, state[table].map(copy)])) as FakeState;
      try {
        return await fn(client);
      } catch (error) {
        // The rollback: everything the callback wrote is undone.
        for (const table of TABLES) state[table] = snapshot[table];
        throw error;
      }
    },
  };
  // The delegates are loosely typed on purpose (one generic implementation);
  // the cast is where the fake promises to honour the structural client.
  return client as unknown as FakeClient;
}
