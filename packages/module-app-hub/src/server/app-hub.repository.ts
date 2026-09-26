/**
 * The slice of a Prisma client this module uses — declared STRUCTURALLY, never
 * imported from a generated one.
 *
 * The module ships `prisma/app-hub.prisma`; the host composes it into its own
 * schema and hands back the client. The app's `satisfies-modules.ts` proves at
 * compile time that its client fits. Every argument shape here is one the
 * service sends, and nothing more.
 */

export interface WorkspaceLayoutRow {
  workspaceId: string;
  organizationId: string;
  /** Json. Narrowed by `readLayout` on every read. */
  layout: unknown;
  updatedBy: string;
  updatedAt: Date;
}

export interface UserLayoutRow {
  workspaceId: string;
  userId: string;
  organizationId: string;
  /** Json. Narrowed by `readLayout` on every read. */
  layout: unknown;
  updatedAt: Date;
}

type UserKey = { workspaceId_userId: { workspaceId: string; userId: string } };

export interface AppHubPrismaClient {
  appHubWorkspaceLayout: {
    findUnique(args: { where: { workspaceId: string } }): Promise<WorkspaceLayoutRow | null>;
    upsert(args: {
      where: { workspaceId: string };
      // A validated layout is a plain object — what the Json column holds.
      create: { workspaceId: string; organizationId: string; layout: object; updatedBy: string };
      update: { layout: object; updatedBy: string };
    }): Promise<WorkspaceLayoutRow>;
    deleteMany(args: { where: { workspaceId: string } }): Promise<{ count: number }>;
  };

  appHubUserLayout: {
    findUnique(args: { where: UserKey }): Promise<UserLayoutRow | null>;
    upsert(args: {
      where: UserKey;
      create: { workspaceId: string; userId: string; organizationId: string; layout: object };
      update: { layout: object };
    }): Promise<UserLayoutRow>;
    deleteMany(args: { where: { workspaceId: string; userId: string } }): Promise<{ count: number }>;
  };
}
