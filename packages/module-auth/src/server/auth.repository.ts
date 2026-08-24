/**
 * The narrow slice of a Prisma client this module needs — declared
 * structurally, never imported from a generated client.
 *
 * Same reasoning as @kwtech/module-permissions: the module opens no connection,
 * reads no DATABASE_URL and has no @prisma/client dependency, so the host
 * injects its own and two apps consuming this module can sit on two different
 * databases. It also means these tests need no database at all — a literal
 * object satisfies the shape.
 */
export const AUTH_PRISMA = 'kwtech:auth-prisma';

export interface AuthUserRow {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  status: 'active' | 'suspended';
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export interface AuthCredentialRow {
  id: string;
  secret: string;
}

export interface AuthSessionRow {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: AuthUserRow;
}

export interface AuthPasswordResetRow {
  id: string;
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  user: AuthUserRow;
}

export type AuthTransaction = Omit<AuthPrismaClient, '$transaction'>;

export interface AuthPrismaClient {
  $transaction<T>(fn: (tx: AuthTransaction) => Promise<T>): Promise<T>;

  authUser: {
    /** By email at sign-in; by id for the caller's own profile. */
    findUnique(args: { where: { email: string } | { id: string } }): Promise<AuthUserRow | null>;
    /**
     * Sign-in accepts an email OR a username, so one query covers both. A
     * username may not contain '@' (domain/policy.ts), so the two branches of
     * the OR can never match different users for the same input.
     */
    findFirst(args: { where: { OR: ({ email: string } | { username: string })[] } }): Promise<AuthUserRow | null>;
    update(args: {
      where: { id: string };
      data: { failedLoginCount?: number; lockedUntil?: Date | null; lastLoginAt?: Date };
    }): Promise<unknown>;
  };

  authCredential: {
    findFirst(args: {
      where: { userId: string; type: 'password' };
      select: { id: true; secret: true };
    }): Promise<AuthCredentialRow | null>;
    upsert(args: {
      where: { userId_type: { userId: string; type: 'password' } };
      create: { userId: string; type: 'password'; secret: string };
      update: { secret: string };
    }): Promise<unknown>;
  };

  authSession: {
    findUnique(args: { where: { refreshTokenHash: string }; include: { user: true } }): Promise<AuthSessionRow | null>;
    create(args: {
      data: {
        userId: string;
        refreshTokenHash: string;
        expiresAt: Date;
        ipAddress: string | null;
        userAgent: string | null;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
    /**
     * Rotation is a CONDITIONAL update — the where clause names the old hash —
     * so two concurrent refreshes cannot both succeed. See AuthService.refresh.
     */
    updateMany(args: {
      where: { id?: string; userId?: string; refreshTokenHash?: string; revokedAt?: null };
      data: { refreshTokenHash?: string; expiresAt?: Date; lastUsedAt?: Date; revokedAt?: Date };
    }): Promise<{ count: number }>;
  };

  authPasswordReset: {
    findUnique(args: { where: { tokenHash: string }; include: { user: true } }): Promise<AuthPasswordResetRow | null>;
    create(args: {
      data: { userId: string; tokenHash: string; expiresAt: Date; requestedIp: string | null };
      select: { id: true };
    }): Promise<{ id: string }>;
    updateMany(args: {
      where: { id?: string; userId?: string; consumedAt?: null };
      data: { consumedAt: Date };
    }): Promise<{ count: number }>;
  };
}
