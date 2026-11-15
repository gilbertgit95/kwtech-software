import type {
  PrintAgentRow,
  PrintPairingCodeRow,
  PrintPrinterRow,
  PrintReceiptDefaultRow,
  PrintReceiptPrinterRow,
  PrintTransaction,
  PrintWriteClient,
} from '../src/server/print.repository.js';

/**
 * An in-memory `PrintWriteClient`, keeping the same promises the database
 * does: lookups by scope, the unique hash columns, and `updateMany` writing
 * only the rows its `where` names — which is what the claim and the
 * revocation check rest on.
 *
 * `$transaction` runs the callback against the same store with no rollback;
 * the suites that care about a refusal inside one assert that nothing was
 * written before it.
 */
export interface FakeClient extends PrintWriteClient {
  agents: PrintAgentRow[];
  codes: PrintPairingCodeRow[];
  printers: PrintPrinterRow[];
  receipts: PrintReceiptPrinterRow[];
  receiptDefaults: PrintReceiptDefaultRow[];
}

type Where = Record<string, unknown>;

/** `{ a: 1, b: null }` against a row; `{ in: [...] }`, `{ not: null }` and `{ lt: Date }` on a field; `OR` of such. */
function matches(row: object, where: object): boolean {
  const record = row as Record<string, unknown>;
  for (const [key, wanted] of Object.entries(where as Where)) {
    if (key === 'OR') {
      if (!(wanted as Where[]).some((branch) => matches(row, branch))) return false;
      continue;
    }
    const value = record[key];
    if (typeof wanted === 'object' && wanted !== null && !(wanted instanceof Date)) {
      const condition = wanted as { in?: unknown[]; not?: unknown; lt?: Date };
      if (condition.in && !condition.in.includes(value)) return false;
      if ('not' in condition && value === condition.not) return false;
      if (condition.lt && !(value instanceof Date && value.getTime() < condition.lt.getTime())) return false;
      continue;
    }
    if (wanted instanceof Date ? !(value instanceof Date && value.getTime() === wanted.getTime()) : value !== wanted) {
      return false;
    }
  }
  return true;
}

function byName<T extends { name: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function fakeClient(): FakeClient {
  let sequence = 0;
  const id = (prefix: string) => {
    sequence += 1;
    return `${prefix}-${sequence}`;
  };
  const agents: PrintAgentRow[] = [];
  const codes: PrintPairingCodeRow[] = [];
  const printers: PrintPrinterRow[] = [];
  const receipts: PrintReceiptPrinterRow[] = [];
  const receiptDefaults: PrintReceiptDefaultRow[] = [];

  const delegates: PrintTransaction = {
    printAgent: {
      async findFirst({ where }) {
        return agents.find((row) => matches(row, where)) ?? null;
      },
      async findUnique({ where }) {
        return agents.find((row) => row.secretHash === where.secretHash) ?? null;
      },
      async findMany({ where, take }) {
        return byName(agents.filter((row) => matches(row, where))).slice(0, take);
      },
      async count({ where }) {
        return agents.filter((row) => matches(row, where)).length;
      },
      async create({ data }) {
        if (agents.some((row) => row.secretHash === data.secretHash))
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        const now = new Date();
        const row: PrintAgentRow = {
          id: id('agent'),
          revokedAt: null,
          revokedById: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        agents.push(row);
        return row;
      },
      async updateMany({ where, data }) {
        const hit = agents.filter((row) => matches(row, where));
        for (const row of hit) Object.assign(row, data, { updatedAt: new Date() });
        return { count: hit.length };
      },
    },
    printPairingCode: {
      async findUnique({ where }) {
        return codes.find((row) => row.codeHash === where.codeHash) ?? null;
      },
      async create({ data }) {
        if (codes.some((row) => row.codeHash === data.codeHash))
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row: PrintPairingCodeRow = { id: id('code'), usedAt: null, createdAt: new Date(), ...data };
        codes.push(row);
        return row;
      },
      async updateMany({ where, data }) {
        const hit = codes.filter((row) => matches(row, where));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      },
      async deleteMany({ where }) {
        const hit = codes.filter((row) => matches(row, where));
        for (const row of hit) codes.splice(codes.indexOf(row), 1);
        return { count: hit.length };
      },
    },
    printPrinter: {
      async findFirst({ where }) {
        return printers.find((row) => matches(row, where)) ?? null;
      },
      async findMany({ where, take }) {
        return byName(printers.filter((row) => matches(row, where))).slice(0, take);
      },
      async upsert({ where, create, update }) {
        const existing = printers.find(
          (row) => row.agentId === where.agentId_name.agentId && row.name === where.agentId_name.name,
        );
        const now = new Date();
        if (existing) {
          Object.assign(existing, update, { updatedAt: now });
          return existing;
        }
        const row: PrintPrinterRow = { id: id('printer'), createdAt: now, updatedAt: now, ...create };
        printers.push(row);
        return row;
      },
      async updateMany({ where, data }) {
        const hit = printers.filter((row) => matches(row, where));
        for (const row of hit) Object.assign(row, data, { updatedAt: new Date() });
        return { count: hit.length };
      },
    },
    printReceiptPrinter: {
      async findMany({ where, take }) {
        return receipts.filter((row) => matches(row, where)).slice(0, take);
      },
      async findFirst({ where }) {
        return receipts.find((row) => matches(row, where)) ?? null;
      },
      async upsert({ where, create, update }) {
        const existing = receipts.find((row) => row.printerId === where.printerId);
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        const row: PrintReceiptPrinterRow = { ...create, updatedAt: new Date() };
        receipts.push(row);
        return row;
      },
      async deleteMany({ where }) {
        const hit = receipts.filter((row) => matches(row, where));
        for (const row of hit) receipts.splice(receipts.indexOf(row), 1);
        return { count: hit.length };
      },
    },
    printReceiptDefault: {
      async findUnique({ where }) {
        return receiptDefaults.find((row) => row.workspaceId === where.workspaceId) ?? null;
      },
      async upsert({ where, create, update }) {
        const existing = receiptDefaults.find((row) => row.workspaceId === where.workspaceId);
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        const row: PrintReceiptDefaultRow = { ...create, updatedAt: new Date() };
        receiptDefaults.push(row);
        return row;
      },
      async deleteMany({ where }) {
        const hit = receiptDefaults.filter((row) => matches(row, where));
        for (const row of hit) receiptDefaults.splice(receiptDefaults.indexOf(row), 1);
        return { count: hit.length };
      },
    },
  };

  return {
    ...delegates,
    agents,
    codes,
    printers,
    receipts,
    receiptDefaults,
    async $transaction(fn) {
      return fn(delegates);
    },
  };
}
