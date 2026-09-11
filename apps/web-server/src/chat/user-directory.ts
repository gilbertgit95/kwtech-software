import type { DirectoryUser, UserDirectory } from '@kwtech/module-chat/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * `module-chat`'s one genuinely new port, filled in by the app.
 *
 * ## Why it lives here and can live nowhere else
 *
 * It reads `auth_user`, which `@kwtech/module-auth` owns, for a feature
 * `@kwtech/module-chat` owns. Neither module may import the other (PLAN §9), so
 * neither can host it — the app is the only layer that already depends on both.
 * The same arrangement as `auth/resolve-principal.ts` and `users.resolver.ts`,
 * and it does NOT widen the seam: the two modules still know nothing of each
 * other.
 *
 * ⚠ An app on a different identity provider implements this same interface and
 * chat does not notice, which is exactly the portability being bought.
 */
@Injectable()
export class ChatUserDirectory implements UserDirectory {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ⚠ EXACT MATCH ONLY, and that is a security decision rather than a
   * simplification.
   *
   * A prefix or substring search over `auth_user` is a customer-list harvester
   * for anybody holding `chat:directory`, and it is the exact surface §12.36
   * refused to expose on sign-up. This answers one question — "does THIS address
   * have an account" — for one address at a time, which is the least it can do
   * and still let somebody start a conversation.
   *
   * ⚠ It still discloses whether an address is registered, to a holder of that
   * key. Accepted, and the key is privileged. The caller is what makes a BLOCKED
   * person indistinguishable from an unknown one — see the resolver.
   *
   * Suspended accounts are excluded: a disabled account should not be reachable,
   * and letting one be invited creates a conversation nobody can answer.
   */
  async findByEmail(email: string): Promise<DirectoryUser | null> {
    const found = await this.prisma.authUser.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, displayName: true, username: true, status: true },
    });
    if (found?.status !== 'active') return null;
    return { id: found.id, displayName: found.displayName ?? found.username ?? found.id };
  }

  /**
   * Names for a page of participants.
   *
   * ⚠ CAPPED, like `findUsersByIds` beside it and for the same reason: a caller
   * asking for more than it can render is a bug in the caller, and an unbounded
   * `in` list is a query worth worrying about. It truncates rather than
   * refusing — a 400 in the middle of a screen load helps nobody.
   */
  async describe(ids: readonly string[]): Promise<readonly DirectoryUser[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.authUser.findMany({
      where: { id: { in: [...new Set(ids)].slice(0, MAX_DIRECTORY_LOOKUP) } },
      select: { id: true, displayName: true, username: true },
    });
    return rows.map((row) => ({ id: row.id, displayName: row.displayName ?? row.username ?? row.id }));
  }
}

/** The same number, and the same argument, as `users.resolver.ts`'s. */
const MAX_DIRECTORY_LOOKUP = 200;
