import type { FileTransaction, FileWriteClient } from '../src/server/file.repository.js';

/**
 * An in-memory stand-in for the host's Prisma client, with the file tables —
 * module-task's fake, smaller.
 *
 * It keeps the promises the rules under test rest on:
 *   - the `@unique` / `@@id` of prisma/file.prisma, raising `P2002`;
 *   - the CASCADE from a file to its shares;
 *   - the ROLLBACK of a failed transaction;
 *   - `updatedAt` moving on every update.
 *
 * ⚠ It supports only the operators the services send (equality, `in`, `lt`,
 * `gt`, `lte`, `OR`) and throws on anything else, so a new query cannot pass against a fake
 * that silently ignored its filter.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export const TABLES = ['fileEntry', 'fileShare', 'fileSettings', 'fileTicket'] as const;
export type TableName = (typeof TABLES)[number];
export type FakeState = Record<TableName, Row[]>;

const UNIQUES: Record<TableName, string[][]> = {
  fileEntry: [['id'], ['storageKey']],
  fileShare: [['fileId', 'userId']],
  fileSettings: [['workspaceId']],
  fileTicket: [['tokenHash']],
};

export function emptyState(): FakeState {
  return { fileEntry: [], fileShare: [], fileSettings: [], fileTicket: [] };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value);

const same = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

function matches(row: Row, where: object): boolean {
  for (const [field, condition] of Object.entries(where)) {
    if (field === 'OR') {
      if (!Array.isArray(condition)) throw new Error('fake: OR must be a list');
      if (!condition.some((branch) => matches(row, branch as Where))) return false;
      continue;
    }
    const value = row[field];
    if (!isPlainObject(condition)) {
      if (!same(value, condition)) return false;
      continue;
    }
    for (const [operator, operand] of Object.entries(condition)) {
      switch (operator) {
        case 'in':
          if (!(operand as unknown[]).some((candidate) => same(value, candidate))) return false;
          break;
        case 'lt':
        case 'gt':
        case 'lte': {
          if (!(value instanceof Date && operand instanceof Date)) return false;
          const order = value.getTime() - operand.getTime();
          if (operator === 'lt' ? order >= 0 : operator === 'gt' ? order <= 0 : order > 0) return false;
          break;
        }
        default:
          throw new Error(`fake: unsupported operator ${operator} on ${field}`);
      }
    }
  }
  return true;
}

function compare(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number | string);
  const y = b instanceof Date ? b.getTime() : (b as number | string);
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

function sorted(rows: Row[], orderBy: Array<Record<string, 'asc' | 'desc'>> = []): Row[] {
  return [...rows].sort((a, b) => {
    for (const clause of orderBy) {
      const [[field, direction]] = Object.entries(clause) as [[string, 'asc' | 'desc']];
      const order = compare(a[field], b[field]);
      if (order !== 0) return direction === 'asc' ? order : -order;
    }
    return 0;
  });
}

function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

let sequence = 0;

export interface FakeClient extends FileWriteClient {
  state: FakeState;
  /** The clock rows are stamped with. Tests move it. */
  now: Date;
}

export function fakeClient(state: FakeState = emptyState()): FakeClient {
  const client = { state, now: new Date('2026-11-16T04:00:00.000Z') } as FakeClient;

  function insert(table: TableName, data: Row): Row {
    sequence += 1;
    const defaults: Record<TableName, Row> = {
      fileEntry: { id: `file-${sequence}`, visibility: 'private', createdAt: client.now, updatedAt: client.now },
      fileShare: { createdAt: client.now },
      fileSettings: { updatedAt: client.now },
      fileTicket: {
        createdAt: client.now,
        fileId: null,
        name: null,
        contentType: null,
        sizeBytes: null,
        visibility: null,
        sharedWith: [],
      },
    };
    const row = { ...defaults[table], ...data };
    for (const keys of UNIQUES[table]) {
      if (client.state[table].some((other) => keys.every((key) => same(other[key], row[key])))) throw uniqueViolation();
    }
    client.state[table].push(row);
    return { ...row };
  }

  function remove(table: TableName, where: object): number {
    const doomed = client.state[table].filter((row) => matches(row, where));
    client.state[table] = client.state[table].filter((row) => !doomed.includes(row));
    // The cascade of prisma/file.prisma: a file takes its shares.
    if (table === 'fileEntry') {
      const ids = new Set(doomed.map((row) => row.id));
      client.state.fileShare = client.state.fileShare.filter((share) => !ids.has(share.fileId));
    }
    return doomed.length;
  }

  const delegates: FileTransaction = {
    fileEntry: {
      async findFirst({ where }) {
        const row = client.state.fileEntry.find((candidate) => matches(candidate, where));
        return row ? ({ ...row } as never) : null;
      },
      async findMany({ where, orderBy, take }) {
        const rows = sorted(
          client.state.fileEntry.filter((row) => matches(row, where)),
          orderBy as Array<Record<string, 'asc' | 'desc'>>,
        );
        return rows.slice(0, take).map((row) => ({ ...row })) as never;
      },
      async aggregate({ where }) {
        const rows = client.state.fileEntry.filter((row) => matches(row, where));
        const sum = rows.reduce((total, row) => total + (row.sizeBytes as number), 0);
        return { _sum: { sizeBytes: rows.length === 0 ? null : sum } };
      },
      async create({ data }) {
        return insert('fileEntry', data as unknown as Row) as never;
      },
      async updateMany({ where, data }) {
        const rows = client.state.fileEntry.filter((row) => matches(row, where));
        for (const row of rows) Object.assign(row, data, { updatedAt: client.now });
        return { count: rows.length };
      },
      async deleteMany({ where }) {
        return { count: remove('fileEntry', where) };
      },
    },
    fileShare: {
      async findMany({ where, take }) {
        return client.state.fileShare
          .filter((row) => matches(row, where))
          .slice(0, take)
          .map((row) => ({ ...row })) as never;
      },
      async createMany({ data }) {
        for (const row of data) insert('fileShare', row as unknown as Row);
        return { count: data.length };
      },
      async deleteMany({ where }) {
        return { count: remove('fileShare', where) };
      },
    },
    fileSettings: {
      async findUnique({ where }) {
        const row = client.state.fileSettings.find((candidate) => candidate.workspaceId === where.workspaceId);
        return row ? ({ ...row } as never) : null;
      },
      async upsert({ where, create, update }) {
        const row = client.state.fileSettings.find((candidate) => candidate.workspaceId === where.workspaceId);
        if (row) {
          Object.assign(row, update, { updatedAt: client.now });
          return { ...row } as never;
        }
        return insert('fileSettings', { ...create } as Row) as never;
      },
    },
    fileTicket: {
      async findUnique({ where }) {
        const row = client.state.fileTicket.find((candidate) => candidate.tokenHash === where.tokenHash);
        return row ? ({ ...row } as never) : null;
      },
      async count({ where }) {
        return client.state.fileTicket.filter((row) => matches(row, where)).length;
      },
      async create({ data }) {
        return insert('fileTicket', data as unknown as Row) as never;
      },
      async deleteMany({ where }) {
        return { count: remove('fileTicket', where) };
      },
    },
  };

  Object.assign(client, delegates, {
    async $transaction<T>(fn: (tx: FileTransaction) => Promise<T>): Promise<T> {
      const snapshot: FakeState = {
        fileEntry: client.state.fileEntry.map((row) => ({ ...row })),
        fileShare: client.state.fileShare.map((row) => ({ ...row })),
        fileSettings: client.state.fileSettings.map((row) => ({ ...row })),
        fileTicket: client.state.fileTicket.map((row) => ({ ...row })),
      };
      try {
        return await fn(delegates);
      } catch (error) {
        client.state = snapshot;
        throw error;
      }
    },
  });
  return client;
}
