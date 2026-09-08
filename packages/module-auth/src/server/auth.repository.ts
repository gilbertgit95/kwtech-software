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

/*
 * ── the administration reads ────────────────────────────────────────────────
 *
 * Separate row types rather than extra fields on `AuthUserRow` and
 * `AuthSessionRow`, and the reason is the tests as much as the design: those
 * two shapes are satisfied by literal objects in a hundred places, and widening
 * them would make every one of those a compile error over a field the sign-in
 * path does not read. A read that needs more says so, where it needs it.
 *
 * They are also genuinely different reads. Signing somebody in wants the
 * smallest row that answers "may this person in"; an administrator looking at
 * an account wants its history. Keeping them apart is what stops the hot path
 * quietly growing columns to serve a back-office screen.
 */

/** `AuthUserRow` plus the timestamps a list of accounts is sorted and read by. */
export interface AuthAdminUserRow extends AuthUserRow {
  createdAt: Date;
  lastLoginAt: Date | null;
}

/**
 * A session as an ADMINISTRATOR sees it: where it is, and when it was last
 * used. Deliberately no `refreshTokenHash` — that is the credential itself, and
 * a screen has no use for it that is not a way to lose it.
 */
export interface AuthAdminSessionRow {
  id: string;
  issuedAt: Date;
  /**
   * NULLABLE, matching the column — a session created and never used again has
   * none. Typed as a plain `Date` first, which the app's `satisfies-modules.ts`
   * check refused: a structural port that overstates what Prisma returns is a
   * null waiting to reach a screen.
   */
  lastUsedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  mfaSatisfiedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * The filter behind the account list.
 *
 * `search` is a substring over email, display name and username — which is
 * exactly the harvesting query `findUserByEmail` refuses to be, and it is
 * correct here for the reason `users:read` exists: this endpoint is the
 * platform's own account list, guarded by a privileged app-level key, rather
 * than a lookup handed to every tenant administrator.
 */
export interface AuthUserFilter {
  search?: string;
  status?: 'active' | 'suspended';
}

export type AuthTransaction = Omit<AuthPrismaClient, '$transaction'>;

/**
 * The one projection every session read uses.
 *
 * A value rather than a type so both call sites pass the same object and cannot
 * drift — and, more to the point, so the field that is NOT here is absent in one
 * visible place. `refreshTokenHash` is the live credential; a bare `findMany`
 * would hand it to whatever asked.
 */
export const SESSION_SUMMARY_SELECT = {
  id: true,
  issuedAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  mfaSatisfiedAt: true,
  ipAddress: true,
  userAgent: true,
} as const;

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
        /**
         * Administration only — `users:suspend`. Nothing on the sign-in path
         * writes this: an account arrives `active` by the column's default, and
         * suspension is always somebody's decision rather than a state the
         * system falls into. `signIn` READS it and refuses, which is the half
         * that has to be unconditional.
         */
        status?: 'active' | 'suspended';
      };
    }): Promise<AuthUserRow>;

    /**
     * The account list. `where` is built by `userFilterWhere` so the filter and
     * its count cannot disagree — a list that pages by one predicate and counts
     * by another reports a total nobody can navigate to.
     */
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: { createdAt?: 'asc' | 'desc'; email?: 'asc' | 'desc' };
      skip?: number;
      take?: number;
    }): Promise<AuthAdminUserRow[]>;

    count(args: { where: Record<string, unknown> }): Promise<number>;

    /**
     * ⚠ The only DELETE this module performs, and the only one it ever should.
     *
     * Everything else here retires a row with a timestamp — `revokedAt`,
     * `consumedAt`, `usedAt`, and `status: 'suspended'` for an account. This
     * exists for erasure, where keeping the row IS the problem, and it is
     * guarded by `users:delete`.
     *
     * What it does NOT clean up: `perm_membership` and `perm_user_role`, which
     * have no foreign key to `auth_user` because the modules must not join
     * across the boundary (PLAN §12.12). Those rows are the app's to remove —
     * see PLAN §12 open decision 38 — and this method is deliberately unaware
     * of them rather than quietly leaving them out of a transaction that looks
     * complete.
     */
    delete(args: { where: { id: string } }): Promise<AuthUserRow>;
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
    /**
     * Sessions, projected by `SESSION_SUMMARY_SELECT` — never the token hashes.
     *
     * ONE signature, and both callers pass the same select: the revocation
     * denylist, which wants ids, and the administration screen, which wants the
     * device and the timestamps. An overload would have been the natural way to
     * express two projections and does not survive contact with the real
     * client: Prisma's `findMany` is one generic method, and a structural port
     * declaring two call signatures stops being assignable from it — the
     * `satisfies-modules.ts` check in the app catches exactly that.
     *
     * So the denylist reads six columns it ignores. That is the price of the
     * port describing what Prisma actually offers, and the columns are
     * timestamps and an address — the one field worth protecting,
     * `refreshTokenHash`, is absent from the select by construction.
     */
    findMany(args: {
      where: { userId: string; revokedAt?: null | { not: null } };
      select: typeof SESSION_SUMMARY_SELECT;
      orderBy?: { lastUsedAt: 'asc' | 'desc' };
    }): Promise<AuthAdminSessionRow[]>;
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
