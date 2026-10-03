import type { BooksMember, BooksMemberDirectory } from '@kwtech/module-basic-bookkeeping/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Names for the books — who recorded and who voided each entry — from
 * `auth_user`, which `module-auth` owns and the books may not read. The POS's
 * directory, for the books.
 *
 * ⚠ ACCOUNT names, shown only to members of the workspace who hold
 * `books:read`: the same people who see them in the other apps.
 */
@Injectable()
export class BooksMemberDirectoryAdapter implements BooksMemberDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async describe(userIds: readonly string[]): Promise<readonly BooksMember[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.authUser.findMany({
      where: { id: { in: [...new Set(userIds)].slice(0, MAX_MEMBER_LOOKUP) } },
      select: { id: true, displayName: true, username: true },
    });
    return rows.map((row) => ({ userId: row.id, displayName: row.displayName ?? row.username ?? row.id }));
  }
}

/** The same number, and the same argument, as the POS and task directories'. */
const MAX_MEMBER_LOOKUP = 200;
