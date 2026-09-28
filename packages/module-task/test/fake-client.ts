import type { TaskWriteClient } from '../src/server/task.repository.js';

/**
 * An in-memory stand-in for the host's Prisma client — `module-note`'s fake,
 * with the tasks tables.
 *
 * The payoff of `TaskTransaction` being STRUCTURAL: the module opens no
 * connection, so its tests need no database. The fake keeps the promises that
 * matter to the rules under test —
 *
 *   - `contains` with LIKE SEMANTICS, `%` and `_` as wildcards and `\` as the
 *     escape, because Postgres does exactly that and Prisma escapes nothing;
 *   - the ROLLBACK of a failed transaction;
 *   - the CASCADES of prisma/task.prisma — a board takes its columns and tasks,
 *     a task its assignees, checklist and comments — and the one NO ACTION: a
 *     column still holding tasks cannot be deleted (proved against Postgres);
 *   - `updatedAt` moving on every update, as `@updatedAt` does.
 *
 * ⚠ It supports only the operators the services send, and throws on anything
 * else, so a new query cannot pass against a fake that silently ignored its
 * filter.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export const TABLES = [
  'taskBoard',
  'taskColumn',
  'task',
  'taskAssignee',
  'taskChecklistItem',
  'taskComment',
  'taskPreference',
] as const;
export type TableName = (typeof TABLES)[number];
export type FakeState = Record<TableName, Row[]>;

/** Mirrors prisma/task.prisma. */
const UNIQUES: Record<TableName, string[][]> = {
  taskBoard: [['id']],
  taskColumn: [['id'], ['boardId', 'nameKey']],
  task: [['id']],
  taskAssignee: [['taskId', 'userId']],
  taskChecklistItem: [['id']],
  taskComment: [['id']],
  taskPreference: [['userId', 'workspaceId']],
};

const COMPOUND_KEYS = new Set(['userId_workspaceId']);

const DEFAULTS: Record<TableName, (id: string, now: Date) => Row> = {
  taskBoard: (id, now) => ({
    id,
    visibility: 'workspace',
    version: 1,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }),
  taskColumn: (id, now) => ({ id, done: false, createdAt: now, updatedAt: now }),
  task: (id, now) => ({
    id,
    description: '',
    priority: 'normal',
    scheduledOn: null,
    dueOn: null,
    labels: [],
    version: 1,
    commentCount: 0,
    completedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }),
  taskAssignee: (_id, now) => ({ createdAt: now }),
  taskChecklistItem: (id, now) => ({ id, done: false, doneById: null, createdAt: now, updatedAt: now }),
  taskComment: (id, now) => ({ id, editedAt: null, createdAt: now }),
  taskPreference: (_id, now) => ({ view: 'board', lastBoardId: null, createdAt: now, updatedAt: now }),
};

export function emptyState(): FakeState {
  return Object.fromEntries(TABLES.map((table) => [table, []])) as unknown as FakeState;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value);

const same = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

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

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Where[]).some((branch) => matches(row, branch));
    if (key === 'AND') return (condition as Where[]).every((branch) => matches(row, branch));
    if (COMPOUND_KEYS.has(key)) return matches(row, condition as Where);
    if (!isPlainObject(condition)) return same(row[key], condition);

    return Object.entries(condition).every(([operator, value]) => {
      switch (operator) {
        case 'in':
          return (value as unknown[]).some((candidate) => same(row[key], candidate));
        case 'notIn':
          return !(value as unknown[]).some((candidate) => same(row[key], candidate));
        case 'not':
          return value === null ? row[key] !== null && row[key] !== undefined : !same(row[key], value);
        case 'has':
          return (row[key] as unknown[]).includes(value);
        case 'contains':
          return likeToRegex(value as string, condition.mode === 'insensitive').test(String(row[key]));
        case 'mode':
          return true;
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

function copy(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) out[key] = Array.isArray(value) ? [...value] : value;
  return out;
}

export interface FakeClient extends TaskWriteClient {
  state: FakeState;
}

export function fakeClient(state: FakeState = emptyState()): FakeClient {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 8, 28, 9, 0, 0, tick++));
  const nextId = (table: TableName) => `${table}-${++tick}`;

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
    const next = copy(row);
    for (const [field, value] of Object.entries(data)) {
      if (isPlainObject(value) && 'increment' in value)
        next[field] = (row[field] as number) + (value.increment as number);
      else if (isPlainObject(value) && 'decrement' in value)
        next[field] = (row[field] as number) - (value.decrement as number);
      else next[field] = value;
    }
    assertUnique(table, next, row);
    Object.assign(row, next);
    if ('updatedAt' in row) row.updatedAt = now();
  }

  function remove(table: TableName, rows: Row[]): void {
    const ids = new Set(rows.map((row) => row.id));
    if (table === 'taskColumn' && state.task.some((task) => ids.has(task.columnId))) {
      // The schema's `onDelete: NoAction` on `Task.column`.
      throw Object.assign(new Error('Foreign key constraint violated: task_task_columnId_fkey'), { code: 'P2003' });
    }
    state[table] = state[table].filter((row) => !rows.includes(row));
    if (table === 'taskBoard') {
      const tasks = state.task.filter((task) => ids.has(task.boardId));
      state.task = state.task.filter((task) => !ids.has(task.boardId));
      cascadeTasks(new Set(tasks.map((task) => task.id)));
      state.taskColumn = state.taskColumn.filter((column) => !ids.has(column.boardId));
    }
    if (table === 'task') cascadeTasks(ids);
  }

  function cascadeTasks(ids: Set<unknown>): void {
    state.taskAssignee = state.taskAssignee.filter((row) => !ids.has(row.taskId));
    state.taskChecklistItem = state.taskChecklistItem.filter((row) => !ids.has(row.taskId));
    state.taskComment = state.taskComment.filter((row) => !ids.has(row.taskId));
  }

  function delegate(table: TableName) {
    const create = async ({ data }: { data: Row }) => {
      const row = { ...DEFAULTS[table](nextId(table), now()), ...copy(data) };
      assertUnique(table, row);
      state[table].push(row);
      return copy(row);
    };
    const find = ({ where }: { where: Where }) => {
      const row = state[table].find((candidate) => matches(candidate, where));
      return row ? copy(row) : null;
    };

    return {
      findFirst: async (args: { where: Where }) => find(args),
      findUnique: async (args: { where: Where }) => find(args),
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
      deleteMany: async ({ where }: { where: Where }) => {
        const rows = state[table].filter((row) => matches(row, where));
        remove(table, rows);
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
