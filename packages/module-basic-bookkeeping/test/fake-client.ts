import type { BooksWriteClient } from '../src/server/books.repository.js';

/**
 * An in-memory stand-in for the host's Prisma client — the point of sale's
 * fake, with the books' tables.
 *
 * The payoff of `BooksTransaction` being STRUCTURAL: the module opens no
 * connection, so its tests need no database. The fake keeps the promises that
 * matter to the rules under test —
 *
 *   - the `@@unique` constraints of prisma/books.prisma, raising `P2002`
 *     (NULLs never clash, as in Postgres);
 *   - the ROLLBACK of a failed transaction;
 *   - `updatedAt` moving on every update, as `@updatedAt` does;
 *   - ⚠ AMOUNTS COME BACK AS `bigint`, as Prisma returns a `BigInt` column, so a
 *     service that forgot to turn one into a number fails here and not in
 *     production.
 *
 * ⚠ It supports only the operators the services send, and throws on anything
 * else, so a new query cannot pass against a fake that silently ignored its
 * filter.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export const TABLES = [
  'booksInvestor',
  'booksLoan',
  'booksEntry',
  'booksSalesImport',
  'booksProfitShare',
  'booksSettings',
] as const;
export type TableName = (typeof TABLES)[number];
export type FakeState = Record<TableName, Row[]>;

/** Mirrors prisma/books.prisma. */
const UNIQUES: Record<TableName, string[][]> = {
  booksInvestor: [['id'], ['workspaceId', 'nameKey']],
  booksLoan: [['id']],
  booksEntry: [['id'], ['workspaceId', 'clientId']],
  booksSalesImport: [['id'], ['workspaceId', 'clientId']],
  booksProfitShare: [['id'], ['workspaceId', 'clientId']],
  booksSettings: [['workspaceId']],
};

/** The `BigInt` columns, per table: stored and returned as `bigint`. */
const BIGINT_COLUMNS: Partial<Record<TableName, readonly string[]>> = {
  booksEntry: ['amount'],
  booksSalesImport: ['cash', 'ewallet', 'bank', 'costOfGoods'],
  booksProfitShare: ['sales', 'refunds', 'costOfGoods', 'expenses', 'profit', 'kept', 'shared'],
};

/** Relation filters the services send, and how to follow them. None yet. */
const RELATIONS: Partial<Record<TableName, Record<string, { table: TableName; key: string }>>> = {};

const VOIDABLE = { voidedAt: null, voidedById: null, voidReason: null };

const DEFAULTS: Record<TableName, (id: string, now: Date) => Row> = {
  booksInvestor: (id, now) => ({
    id,
    contact: null,
    note: null,
    agreedShare: null,
    formerAt: null,
    createdAt: now,
    updatedAt: now,
  }),
  booksLoan: (id, now) => ({ id, contact: null, note: null, createdAt: now, updatedAt: now }),
  booksEntry: (id, now) => ({ id, advance: false, clientId: null, createdAt: now, ...VOIDABLE }),
  booksSalesImport: (id, now) => ({ id, createdAt: now, ...VOIDABLE }),
  booksProfitShare: (id, now) => ({ id, createdAt: now, ...VOIDABLE }),
  booksSettings: (_id, now) => ({
    shareMode: 'capital',
    posImportFrom: null,
    posRecordedThrough: null,
    sharedThrough: null,
    version: 1,
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

const OPERATORS = new Set(['in', 'notIn', 'not', 'contains', 'mode', 'gt', 'gte', 'lt', 'lte']);

/** A LIKE pattern as a regex: `%` any run, `_` any one character, `\x` a literal x. */
function likeToRegex(pattern: string, insensitive: boolean): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const character = pattern[i] ?? '';
    if (character === '\\' && i + 1 < pattern.length) {
      i += 1;
      source += (pattern[i] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      continue;
    }
    if (character === '%') source += '.*';
    else if (character === '_') source += '.';
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^.*${source}.*$`, insensitive ? 'is' : 's');
}

function compare(a: unknown, b: unknown): number {
  // Postgres sorts NULL LAST ascending.
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  const x = a instanceof Date ? a.getTime() : (a as number | string | bigint);
  const y = b instanceof Date ? b.getTime() : (b as number | string | bigint);
  if (x === y) return 0;
  return x < y ? -1 : 1;
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

function copy(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) out[key] = Array.isArray(value) ? [...value] : value;
  return out;
}

export interface FakeClient extends BooksWriteClient {
  state: FakeState;
  /** How many transactions ran — so a test can prove a write was one. */
  transactions: number;
}

export function fakeClient(state: FakeState = emptyState()): FakeClient {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 9, 1, 2, 0, 0, tick++));
  const nextId = (table: TableName) => `${table}-${++tick}`;

  function matches(table: TableName, row: Row, where: Where | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, condition]) => {
      if (key === 'OR') return (condition as Where[]).some((branch) => matches(table, row, branch));
      const relation = RELATIONS[table]?.[key];
      if (relation) {
        const target = state[relation.table].find((candidate) => candidate.id === row[relation.key]);
        return target !== undefined && matches(relation.table, target, condition as Where);
      }
      if (!isPlainObject(condition)) return same(row[key], condition);
      return Object.entries(condition).every(([operator, value]) => {
        if (!OPERATORS.has(operator)) throw new Error(`fake client: unsupported operator '${operator}' on ${key}`);
        const field = row[key];
        switch (operator) {
          case 'in':
            return (value as unknown[]).some((candidate) => same(field, candidate));
          case 'notIn':
            return !(value as unknown[]).some((candidate) => same(field, candidate));
          case 'not':
            return value === null ? field !== null && field !== undefined : !same(field, value);
          case 'contains':
            return (
              typeof field === 'string' && likeToRegex(value as string, condition.mode === 'insensitive').test(field)
            );
          case 'gt':
            return field !== null && field !== undefined && compare(field, value) > 0;
          case 'gte':
            return field !== null && field !== undefined && compare(field, value) >= 0;
          case 'lt':
            return field !== null && field !== undefined && compare(field, value) < 0;
          case 'lte':
            return field !== null && field !== undefined && compare(field, value) <= 0;
          default:
            return true;
        }
      });
    });
  }

  function assertUnique(table: TableName, candidate: Row, ignore?: Row): void {
    for (const fields of UNIQUES[table]) {
      if (fields.some((field) => candidate[field] === null || candidate[field] === undefined)) continue;
      const clash = state[table].some(
        (row) => row !== ignore && fields.every((field) => same(row[field], candidate[field])),
      );
      if (clash) {
        throw Object.assign(new Error(`Unique constraint failed on ${table}(${fields.join(', ')})`), { code: 'P2002' });
      }
    }
  }

  /** `BigInt` columns as Prisma stores them: a number written comes back a `bigint`. */
  function asStored(table: TableName, data: Row): Row {
    const out = { ...data };
    for (const column of BIGINT_COLUMNS[table] ?? []) {
      if (typeof out[column] === 'number') out[column] = BigInt(out[column] as number);
    }
    return out;
  }

  function apply(table: TableName, row: Row, data: Row): void {
    const next = copy(row);
    for (const [field, value] of Object.entries(asStored(table, data))) {
      if (isPlainObject(value) && 'increment' in value)
        next[field] = (row[field] as number) + (value.increment as number);
      else next[field] = value;
    }
    assertUnique(table, next, row);
    Object.assign(row, next);
    if ('updatedAt' in row) row.updatedAt = now();
  }

  function delegate(table: TableName) {
    const create = async ({ data }: { data: Row }) => {
      const row = { ...DEFAULTS[table](nextId(table), now()), ...asStored(table, copy(data)) };
      assertUnique(table, row);
      state[table].push(row);
      return copy(row);
    };
    const find = ({ where }: { where: Where }) => {
      const row = state[table].find((candidate) => matches(table, candidate, where));
      return row ? copy(row) : null;
    };
    return {
      findFirst: async (args: { where: Where }) => find(args),
      findUnique: async (args: { where: Where }) => find(args),
      findMany: async (args: { where?: Where; orderBy?: unknown; take?: number }) => {
        const rows = sortRows(
          state[table].filter((row) => matches(table, row, args.where)),
          args.orderBy,
        );
        return rows.slice(0, args.take).map((row) => copy(row));
      },
      count: async ({ where }: { where: Where }) => state[table].filter((row) => matches(table, row, where)).length,
      create,
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        const rows = state[table].filter((row) => matches(table, row, where));
        for (const row of rows) apply(table, row, data);
        return { count: rows.length };
      },
      deleteMany: async ({ where }: { where: Where }) => {
        const rows = state[table].filter((row) => matches(table, row, where));
        state[table] = state[table].filter((row) => !rows.includes(row));
        return { count: rows.length };
      },
      upsert: async ({ where, create: createData, update }: { where: Where; create: Row; update: Row }) => {
        const row = state[table].find((candidate) => matches(table, candidate, where));
        if (!row) return create({ data: createData });
        apply(table, row, update);
        return copy(row);
      },
    };
  }

  const client = {
    state,
    transactions: 0,
    ...Object.fromEntries(TABLES.map((table) => [table, delegate(table)])),
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      client.transactions += 1;
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
