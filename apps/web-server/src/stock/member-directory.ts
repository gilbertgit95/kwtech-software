import type { StockMember, StockMemberDirectory } from '@kwtech/module-basic-inventory/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Names for the stock history — who received, adjusted, wasted or counted —
 * from `auth_user`, which `module-auth` owns and stock may not read. The books'
 * directory, for stock.
 *
 * ⚠ ACCOUNT names, shown only to members of the workspace who hold
 * `stock:read`: the same people who see them in the other apps.
 */
@Injectable()
export class StockMemberDirectoryAdapter implements StockMemberDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async describe(userIds: readonly string[]): Promise<readonly StockMember[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.authUser.findMany({
      where: { id: { in: [...new Set(userIds)].slice(0, MAX_MEMBER_LOOKUP) } },
      select: { id: true, displayName: true, username: true },
    });
    return rows.map((row) => ({ userId: row.id, displayName: row.displayName ?? row.username ?? row.id }));
  }
}

/** The same number, and the same argument, as the POS, task and books directories'. */
const MAX_MEMBER_LOOKUP = 200;
