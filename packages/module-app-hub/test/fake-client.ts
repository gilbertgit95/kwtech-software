import type { AppHubPrismaClient, UserLayoutRow, WorkspaceLayoutRow } from '../src/server/app-hub.repository.js';

/**
 * An in-memory stand-in for the host's Prisma client — possible because the
 * client is STRUCTURAL, so the service's tests need no database.
 *
 * It keeps the one promise that matters to these rules: the PRIMARY KEYS. A
 * workspace has one default and a person one layout per workspace, so an
 * upsert replaces rather than adds, exactly as the schema forces.
 */
export interface FakeState {
  workspace: WorkspaceLayoutRow[];
  user: UserLayoutRow[];
}

export function createFakeClient(state: FakeState = { workspace: [], user: [] }): {
  client: AppHubPrismaClient;
  state: FakeState;
} {
  const client: AppHubPrismaClient = {
    appHubWorkspaceLayout: {
      async findUnique({ where }) {
        return state.workspace.find((row) => row.workspaceId === where.workspaceId) ?? null;
      },
      async upsert({ where, create, update }) {
        const existing = state.workspace.find((row) => row.workspaceId === where.workspaceId);
        const now = new Date();
        if (existing) {
          Object.assign(existing, update, { updatedAt: now });
          return existing;
        }
        const row: WorkspaceLayoutRow = { ...create, updatedAt: now };
        state.workspace.push(row);
        return row;
      },
      async deleteMany({ where }) {
        const before = state.workspace.length;
        state.workspace = state.workspace.filter((row) => row.workspaceId !== where.workspaceId);
        return { count: before - state.workspace.length };
      },
    },
    appHubUserLayout: {
      async findUnique({ where }) {
        const { workspaceId, userId } = where.workspaceId_userId;
        return state.user.find((row) => row.workspaceId === workspaceId && row.userId === userId) ?? null;
      },
      async upsert({ where, create, update }) {
        const { workspaceId, userId } = where.workspaceId_userId;
        const existing = state.user.find((row) => row.workspaceId === workspaceId && row.userId === userId);
        const now = new Date();
        if (existing) {
          Object.assign(existing, update, { updatedAt: now });
          return existing;
        }
        const row: UserLayoutRow = { ...create, updatedAt: now };
        state.user.push(row);
        return row;
      },
      async deleteMany({ where }) {
        const before = state.user.length;
        state.user = state.user.filter(
          (row) => !(row.workspaceId === where.workspaceId && row.userId === where.userId),
        );
        return { count: before - state.user.length };
      },
    },
  };
  return { client, state };
}
