import type { PosMember, PosMemberDirectory } from '@kwtech/module-basic-pos/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Names for the POS — "by staff", and who did what on an order — from
 * `auth_user`, which `module-auth` owns and the POS may not read.
 *
 * ⚠ ACCOUNT names, shown to members of the workspace who hold `pos:reports`
 * or can open the order: the same people who see them in the task app.
 */
@Injectable()
export class PosMemberDirectoryAdapter implements PosMemberDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async describe(userIds: readonly string[]): Promise<readonly PosMember[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.authUser.findMany({
      where: { id: { in: [...new Set(userIds)].slice(0, MAX_MEMBER_LOOKUP) } },
      select: { id: true, displayName: true, username: true },
    });
    return rows.map((row) => ({ userId: row.id, displayName: row.displayName ?? row.username ?? row.id }));
  }
}

/** The same number, and the same argument, as the task directory's. */
const MAX_MEMBER_LOOKUP = 200;
