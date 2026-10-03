import type { PosWriteClient } from '../src/server/pos.repository.js';

/**
 * An in-memory stand-in for the host's Prisma client — `module-task`'s fake,
 * with the POS tables.
 *
 * The payoff of `PosTransaction` being STRUCTURAL: the module opens no
 * connection, so its tests need no database. The fake keeps the promises that
 * matter to the rules under test —
 *
 *   - the `@@unique` constraints of prisma/pos.prisma, raising `P2002`
 *     (NULLs never clash, as in Postgres);
 *   - `contains` with LIKE SEMANTICS, `%` and `_` as wildcards and `\` as the
 *     escape, because Postgres does exactly that and Prisma escapes nothing;
 *   - the ROLLBACK of a failed transaction;
 *   - `updatedAt` moving on every update, as `@updatedAt` does.
 *
 * ⚠ It supports only the operators the services send, and throws on anything
 * else, so a new query cannot pass against a fake that silently ignored its
 * filter.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export const TABLES = [
  'posCategory',
  'posItem',
  'posItemVariant',
  'posCustomer',
  'posOrder',
  'posOrderLine',
  'posRefund',
  'posRefundLine',
  'posCounter',
  'posSettings',
] as const;
export type TableName = (typeof TABLES)[number];
export type FakeState = Record<TableName, Row[]>;

/** Mirrors prisma/pos.prisma. */
const UNIQUES: Record<TableName, string[][]> = {
  posCategory: [['id'], ['workspaceId', 'nameKey']],
  posItem: [['id'], ['workspaceId', 'code']],
  posItemVariant: [['id'], ['workspaceId', 'code']],
  posCustomer: [['id']],
  posOrder: [['id'], ['workspaceId', 'number'], ['workspaceId', 'paymentClientId']],
  posOrderLine: [['id']],
  posRefund: [['id'], ['workspaceId', 'clientId']],
  posRefundLine: [['id']],
  posCounter: [['workspaceId']],
  posSettings: [['workspaceId']],
};

/** Relation filters the services send, and how to follow them. */
const RELATIONS: Partial<Record<TableName, Record<string, { table: TableName; key: string }>>> = {
  posItemVariant: { item: { table: 'posItem', key: 'itemId' } },
};

const DEFAULTS: Record<TableName, (id: string, now: Date) => Row> = {
  posCategory: (id, now) => ({ id, sortOrder: 0, archivedAt: null, createdAt: now, updatedAt: now }),
  posItem: (id, now) => ({
    id,
    categoryId: null,
    kind: 'product',
    code: null,
    description: null,
    cost: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }),
  posItemVariant: (id, now) => ({
    id,
    code: null,
    cost: null,
    sortOrder: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }),
  posCustomer: (id, now) => ({
    id,
    phone: null,
    email: null,
    facebookUrl: null,
    note: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }),
  posOrder: (id, now) => ({
    id,
    status: 'open',
    version: 1,
    number: null,
    label: null,
    heldAt: null,
    customerId: null,
    customerName: null,
    customerContact: null,
    gross: 0,
    lineDiscounts: 0,
    subtotal: 0,
    orderDiscount: 0,
    total: 0,
    discountKind: null,
    discountValue: null,
    discountReason: null,
    discountById: null,
    discountAt: null,
    paymentMethod: null,
    received: null,
    change: null,
    tip: 0,
    paymentReference: null,
    paymentClientId: null,
    changeOwed: 0,
    changeSettlement: null,
    changeSettledAt: null,
    changeSettledById: null,
    finalisedAt: null,
    finalisedById: null,
    releasedUnpaid: false,
    paidAt: null,
    paidById: null,
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    voidedAt: null,
    voidedById: null,
    voidReason: null,
    createdAt: now,
    updatedAt: now,
  }),
  posOrderLine: (id, now) => ({
    id,
    variantId: null,
    variantName: null,
    code: null,
    categoryName: null,
    unitCost: null,
    note: null,
    discountKind: null,
    discountValue: null,
    discountAmount: 0,
    discountReason: null,
    discountById: null,
    discountAt: null,
    createdAt: now,
    updatedAt: now,
  }),
  posRefund: (id, now) => ({ id, refundedAt: now }),
  posRefundLine: (id) => ({ id }),
  posCounter: () => ({ nextNumber: 1 }),
  posSettings: (_id, now) => ({ keymap: null, version: 1, createdAt: now, updatedAt: now }),
};

export function emptyState(): FakeState {
  return Object.fromEntries(TABLES.map((table) => [table, []])) as unknown as FakeState;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value);

const same = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

const OPERATORS = new Set(['in', 'notIn', 'not', 'contains', 'mode', 'gt', 'gte', 'lt']);

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
  const x = a instanceof Date ? a.getTime() : (a as number | string);
  const y = b instanceof Date ? b.getTime() : (b as number | string);
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

export interface FakeClient extends PosWriteClient {
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

  function apply(table: TableName, row: Row, data: Row): void {
    const next = copy(row);
    for (const [field, value] of Object.entries(data)) {
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
      const row = { ...DEFAULTS[table](nextId(table), now()), ...copy(data) };
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
