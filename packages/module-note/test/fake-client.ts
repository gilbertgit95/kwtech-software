import type { NoteWriteClient } from '../src/server/note.repository.js';

/**
 * An in-memory stand-in for the host's Prisma client.
 *
 * The payoff of `NoteTransaction` being STRUCTURAL: the module opens no
 * connection, so its tests need no database. The fake keeps the promises that
 * matter to the rules under test —
 *
 *   - `contains` with LIKE SEMANTICS, `%` and `_` as wildcards and `\` as the
 *     escape, because Postgres does exactly that and Prisma escapes nothing: a
 *     search that forgot `escapeLikePattern` fails here as it would in production;
 *   - the ROLLBACK of a failed transaction, so a save that lost its
 *     compare-and-set leaves no revision behind;
 *   - the CASCADE from a note to its pins and revisions;
 *   - `updatedAt` moving on every update, as `@updatedAt` does.
 *
 * ⚠ It supports only the operators the services send, and throws on anything
 * else, so a new query cannot pass against a fake that silently ignored its
 * filter.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export const TABLES = ['note', 'notePin', 'noteRevision', 'notePreference'] as const;
export type TableName = (typeof TABLES)[number];
export type FakeState = Record<TableName, Row[]>;

/** Mirrors prisma/note.prisma. */
const UNIQUES: Record<TableName, string[][]> = {
  note: [['id']],
  notePin: [['userId', 'noteId']],
  noteRevision: [['id']],
  notePreference: [['userId', 'workspaceId']],
};

/** Compound unique inputs, `userId_noteId: { userId, noteId }`, and the columns they name. */
const COMPOUND_KEYS = new Set(['userId_noteId', 'userId_workspaceId']);

const DEFAULTS: Record<TableName, (id: string, now: Date) => Row> = {
  note: (id, now) => ({
    id,
    title: '',
    body: '',
    preview: '',
    visibility: 'private',
    color: 'default',
    tags: [],
    version: 1,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }),
  notePin: (_id, now) => ({ createdAt: now }),
  noteRevision: (id, now) => ({ id, createdAt: now }),
  notePreference: (_id, now) => ({
    look: 'notebook',
    font: 'hand',
    defaultColor: 'default',
    createdAt: now,
    updatedAt: now,
  }),
};

export function emptyState(): FakeState {
  return { note: [], notePin: [], noteRevision: [], notePreference: [] };
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
  // `contains` wraps the value in % on both sides.
  return new RegExp(`^.*${source}.*$`, insensitive ? 'is' : 's');
}

function compare(a: unknown, b: unknown): number {
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
          return !same(row[key], value);
        case 'lt':
          return compare(row[key], value) < 0;
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

function copy(row: Row, omit?: Record<string, boolean>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (omit?.[key]) continue;
    out[key] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

export interface FakeClient extends NoteWriteClient {
  state: FakeState;
  /** Run before the next `updateMany` / `deleteMany` on notes — to lose a race on purpose. */
  beforeNextNoteWrite(hook: () => void): void;
}

export function fakeClient(state: FakeState = emptyState()): FakeClient {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 8, 28, 9, 0, 0, tick++));
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

  function apply(row: Row, data: Row): void {
    for (const [field, value] of Object.entries(data)) {
      row[field] =
        isPlainObject(value) && 'increment' in value ? (row[field] as number) + (value.increment as number) : value;
    }
    if ('updatedAt' in row) row.updatedAt = now();
  }

  function remove(table: TableName, rows: Row[]): void {
    state[table] = state[table].filter((row) => !rows.includes(row));
    if (table !== 'note') return;
    // The schema's `onDelete: Cascade`.
    const ids = new Set(rows.map((row) => row.id));
    state.notePin = state.notePin.filter((pin) => !ids.has(pin.noteId));
    state.noteRevision = state.noteRevision.filter((revision) => !ids.has(revision.noteId));
  }

  function delegate(table: TableName) {
    const create = async ({ data }: { data: Row }) => {
      const row = { ...DEFAULTS[table](nextId(table), now()), ...copy(data) };
      assertUnique(table, row);
      state[table].push(row);
      return copy(row);
    };

    return {
      findFirst: async ({ where }: { where: Where }) => {
        const row = state[table].find((candidate) => matches(candidate, where));
        return row ? copy(row) : null;
      },
      findUnique: async ({ where }: { where: Where }) => {
        const row = state[table].find((candidate) => matches(candidate, where));
        return row ? copy(row) : null;
      },
      findMany: async (args: { where?: Where; orderBy?: unknown; take?: number; skip?: number; omit?: Row }) => {
        const rows = sortRows(
          state[table].filter((row) => matches(row, args.where)),
          args.orderBy,
        );
        const start = args.skip ?? 0;
        const page = rows.slice(start, args.take === undefined ? undefined : start + args.take);
        return page.map((row) => copy(row, args.omit as Record<string, boolean> | undefined));
      },
      count: async ({ where }: { where: Where }) => state[table].filter((row) => matches(row, where)).length,
      create,
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        if (table === 'note') runHook();
        const rows = state[table].filter((row) => matches(row, where));
        for (const row of rows) apply(row, data);
        return { count: rows.length };
      },
      deleteMany: async ({ where }: { where: Where }) => {
        if (table === 'note') runHook();
        const rows = state[table].filter((row) => matches(row, where));
        remove(table, rows);
        return { count: rows.length };
      },
      upsert: async ({ where, create: createData, update }: { where: Where; create: Row; update: Row }) => {
        const row = state[table].find((candidate) => matches(candidate, where));
        if (!row) return create({ data: createData });
        apply(row, update);
        return copy(row);
      },
    };
  }

  const client = {
    state,
    beforeNextNoteWrite(next: () => void) {
      hook = next;
    },
    note: delegate('note'),
    notePin: delegate('notePin'),
    noteRevision: delegate('noteRevision'),
    notePreference: delegate('notePreference'),
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const snapshot = Object.fromEntries(
        TABLES.map((table) => [table, state[table].map((row) => copy(row))]),
      ) as FakeState;
      try {
        return await fn(client);
      } catch (error) {
        // Roll back: every table as it was before the transaction began.
        for (const table of TABLES) state[table] = snapshot[table];
        throw error;
      }
    },
  };
  // Structural, as the host's adapter is: the delegates fit where it matters,
  // and the services under test exercise them.
  return client as unknown as FakeClient;
}
