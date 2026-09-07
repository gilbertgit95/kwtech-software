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
  /**
   * When a second factor became mandatory for this account — a POLICY, not a
   * state. "Do they hold a confirmed factor" is a different question, answered
   * by a row rather than by a column that could drift from one.
   */
  mfaRequiredAt: Date | null;
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
  /**
   * When the second factor was satisfied for THIS session. Null means password
   * alone — which is why refresh() re-derives the token scope from this field
   * instead of trusting the scope of the token being replaced.
   */
  mfaSatisfiedAt: Date | null;
  user: AuthUserRow;
}

export interface AuthPasswordResetRow {
  id: string;
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  user: AuthUserRow;
}

export interface AuthMfaFactorRow {
  id: string;
  userId: string;
  /**
   * Widened to match the COLUMN, not what this module implements.
   *
   * `AuthMfaFactorType` in the schema is `totp | webauthn`, and narrowing the
   * row to 'totp' would be this interface asserting something about the
   * database that is not true — a structural client has to describe what Prisma
   * actually returns or it stops being a safe stand-in. Nothing enrols a
   * webauthn factor today; every QUERY below pins `type: 'totp'` so that
   * "owes a factor" and "can satisfy a factor" stay the same set by
   * construction rather than by remembering.
   */
  type: 'totp' | 'webauthn';
  label: string;
  /** Ciphertext, always. See server/secret-box.ts for why it cannot be a hash. */
  secret: string;
  confirmedAt: Date | null;
  lastUsedAt: Date | null;
  /**
   * Prisma maps `BigInt` to a JS bigint. Kept as one here rather than narrowed
   * to `number`, so the boundary conversion happens in one visible place
   * instead of silently at every read.
   */
  lastUsedStep: bigint | null;
}

export interface AuthRecoveryCodeRow {
  id: string;
  userId: string;
  codeHash: string;
  usedAt: Date | null;
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

    /**
     * Creating an account — `createAccount`, and nothing else in this module.
     *
     * No `username` and no `status` in the shape, deliberately. A username is
     * chosen later, from a settings screen that can tell somebody theirs is
     * taken; an account created here is `active` by the column's default, and
     * letting a caller pass anything else would make "suspended on arrival" a
     * state something could reach by accident.
     */
    create(args: { data: { email: string; displayName: string | null } }): Promise<AuthUserRow>;
    update(args: {
      where: { id: string };
      data: {
        failedLoginCount?: number;
        lockedUntil?: Date | null;
        lastLoginAt?: Date;
        /** Free text the person chose. Never an identifier. */
        displayName?: string | null;
        /** Normalised before it gets here. `@unique`, so a clash throws. */
        username?: string;
      };
    }): Promise<AuthUserRow>;
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
    create(args: { data: { userId: string; type: 'password'; secret: string } }): Promise<unknown>;
  };

  authSession: {
    findUnique(args: {
      where: { refreshTokenHash: string } | { id: string };
      include: { user: true };
    }): Promise<AuthSessionRow | null>;
    /** Ids only, for the revocation denylist — never the token hashes. */
    findMany(args: {
      where: { userId: string; revokedAt?: null | { not: null } };
      select: { id: true };
    }): Promise<{ id: string }[]>;
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
      where: {
        id?: string;
        userId?: string;
        refreshTokenHash?: string;
        revokedAt?: null;
        /** `not` so "every session EXCEPT this one" is expressible — see confirmMfa. */
        NOT?: { id: string };
      };
      data: { refreshTokenHash?: string; expiresAt?: Date; lastUsedAt?: Date; revokedAt?: Date; mfaSatisfiedAt?: Date };
    }): Promise<{ count: number }>;
  };

  /**
   * Second factors. Note there is no `findUnique` by id alone: every lookup is
   * scoped by `userId` as well, so a factor id guessed or leaked from another
   * account cannot be confirmed or revoked by its non-owner. That is a
   * property of the query shape, not of a check somebody has to remember.
   */
  authMfaFactor: {
    findFirst(args: {
      where: { userId: string; id?: string; type?: 'totp'; confirmedAt?: null | { not: null } };
    }): Promise<AuthMfaFactorRow | null>;
    findMany(args: {
      where: { userId: string; type?: 'totp'; confirmedAt?: null | { not: null } };
      orderBy?: { createdAt: 'asc' | 'desc' };
    }): Promise<AuthMfaFactorRow[]>;
    create(args: {
      data: { userId: string; type: 'totp'; label: string; secret: string };
      select: { id: true };
    }): Promise<{ id: string }>;
    /**
     * `lastUsedStep: { lt }` in the WHERE clause, not just in the data.
     *
     * That is what makes a code single-use under concurrency: two requests
     * carrying the same code race here, and the database — not the read above
     * — decides that only one of them advances the step. Checking `lastUsedStep`
     * in application code and writing unconditionally would let both through.
     */
    updateMany(args: {
      where: {
        id: string;
        userId: string;
        confirmedAt?: null | { not: null };
        OR?: ({ lastUsedStep: null } | { lastUsedStep: { lt: bigint } })[];
      };
      data: { confirmedAt?: Date; lastUsedAt?: Date; lastUsedStep?: bigint };
    }): Promise<{ count: number }>;
    deleteMany(args: { where: { id?: string; userId: string; confirmedAt?: null } }): Promise<{ count: number }>;
  };

  /**
   * The way back in when the factor is lost.
   *
   * `codeHash` is `@unique` across the table, so the lookup needs no userId —
   * but the service checks the row's owner anyway, because a global unique
   * index is a property of today's schema and the check costs nothing.
   */
  authRecoveryCode: {
    findMany(args: { where: { userId: string; usedAt?: null } }): Promise<AuthRecoveryCodeRow[]>;
    createMany(args: { data: { userId: string; codeHash: string }[] }): Promise<{ count: number }>;
    updateMany(args: { where: { id: string; usedAt: null }; data: { usedAt: Date } }): Promise<{ count: number }>;
    deleteMany(args: { where: { userId: string } }): Promise<{ count: number }>;
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
