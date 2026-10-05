import type { StudioMember, StudioMemberDirectory } from '@kwtech/module-print-studio/server';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Names for a layout's owner and for who printed what.
 *
 * ## Why it lives here
 *
 * Names are `auth_user`, which `module-auth` owns, and a module may not read
 * another's tables (PLAN §9) — the reason `NoteAuthorDirectoryAdapter` and the
 * queue's staff directory are app-side too.
 *
 * ⚠ ACCOUNT names, shown to members of the workspace beside layouts and
 * history entries they can already see. The module only asks about ids on rows
 * the viewer may see.
 */
@Injectable()
export class StudioMemberDirectoryAdapter implements StudioMemberDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async describe(userIds: readonly string[]): Promise<readonly StudioMember[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.authUser.findMany({
      where: { id: { in: [...new Set(userIds)].slice(0, MAX_MEMBER_LOOKUP) } },
      select: { id: true, displayName: true, username: true },
    });
    return rows.map((row) => ({ userId: row.id, displayName: row.displayName ?? row.username ?? row.id }));
  }
}

/**
 * A list of layouts or a page of history names a handful of people, so this
 * bounds a strange request rather than a normal one. The same number as the
 * notes' and the queue's lookups.
 */
const MAX_MEMBER_LOOKUP = 200;
